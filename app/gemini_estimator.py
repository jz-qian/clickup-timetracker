"""Gemini-backed task-time estimator."""

import json
import os

import requests

from app import estimator

MODEL = "gemini-2.5-flash"
API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}"
REQUEST_TIMEOUT_SECONDS = 60


def _schema_for_gemini(schema):
    result = {}
    for key, value in schema.items():
        if key == "type":
            result[key] = value.upper()
        elif key == "additionalProperties":
            continue
        elif key == "properties":
            result[key] = {
                name: _schema_for_gemini(property_schema)
                for name, property_schema in value.items()
            }
        elif key == "items":
            result[key] = _schema_for_gemini(value)
        else:
            result[key] = value
    return result


FUNCTION_DECLARATIONS = [
    {
        "name": tool["name"],
        "description": tool["description"],
        "parameters": _schema_for_gemini(tool["input_schema"]),
    }
    for tool in estimator.TOOLS
]


def _api_request(method, api_key, *, json_body=None):
    headers = {"x-goog-api-key": api_key}
    try:
        response = requests.request(
            method,
            API_URL,
            headers=headers,
            json=json_body,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.Timeout as error:
        raise estimator.EstimatorError("Gemini did not respond in time.") from error
    except requests.ConnectionError as error:
        raise estimator.EstimatorError("Could not reach the Gemini API.") from error
    except requests.RequestException as error:
        raise estimator.EstimatorError("The Gemini API request failed.") from error

    if response.status_code in (401, 403):
        raise estimator.EstimatorError(
            "Gemini rejected this API key or the key cannot access the model."
        )
    if response.status_code == 429:
        raise estimator.EstimatorError("Gemini rate limit reached. Try again shortly.")
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("message")
        except (ValueError, AttributeError):
            detail = None
        raise estimator.EstimatorError(detail or f"Gemini API request failed ({response.status_code}).")

    try:
        return response.json()
    except ValueError as error:
        raise estimator.EstimatorError("Gemini returned an invalid response.") from error


def _api_key(api_key):
    return api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")


def check_api_key(api_key):
    _api_request("GET", _api_key(api_key))


def _find_similar_tasks(api_key, history, task_name, task_description):
    request_text = f"New task: {task_name}"
    if task_description:
        request_text += f"\n\nDescription: {task_description}"

    contents = [{"role": "user", "parts": [{"text": request_text}]}]
    request_body = {
        "systemInstruction": {
            "parts": [{
                "text": (
                    estimator.SYSTEM_PROMPT
                    + "\nReturn the final answer as a JSON object with "
                    "similar_task_ids, reasoning, and confidence."
                )
            }]
        },
        "contents": contents,
        "tools": [{"functionDeclarations": FUNCTION_DECLARATIONS}],
        "generationConfig": {"maxOutputTokens": 8192},
    }

    for _ in range(estimator.MAX_AGENT_TURNS):
        response = _api_request("POST", _api_key(api_key), json_body=request_body)
        candidates = response.get("candidates") or []
        if not candidates:
            raise estimator.EstimatorError("Gemini returned no answer for this task.")

        candidate = candidates[0]
        content = candidate.get("content") or {}
        parts = content.get("parts") or []
        function_calls = [
            part["functionCall"]
            for part in parts
            if isinstance(part, dict) and "functionCall" in part
        ]

        if function_calls:
            contents.append(content)
            function_responses = []
            for function_call in function_calls:
                name = function_call.get("name")
                args = function_call.get("args") or {}
                try:
                    result = estimator._run_tool(history, name, args)
                except (KeyError, TypeError, ValueError) as error:
                    result = {"error": str(error)}
                function_responses.append({
                    "functionResponse": {
                        "name": name,
                        "response": {"result": result},
                    }
                })
            contents.append({"role": "user", "parts": function_responses})
            continue

        if candidate.get("finishReason") == "MAX_TOKENS":
            raise estimator.EstimatorError(
                "The AI model's answer was cut off. Try a shorter description."
            )

        text = "".join(
            part.get("text", "")
            for part in parts
            if isinstance(part, dict)
        )
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise estimator.EstimatorError(
                "The AI model's answer couldn't be read. Try again."
            ) from error

    raise estimator.EstimatorError("The AI model took too many steps without answering.")


def estimate_task(api_key, task_name, task_description=""):
    history = estimator.task_history_cache.get()
    answer = _find_similar_tasks(api_key, history, task_name, task_description)
    return estimator._format_estimate(history, task_name, answer)
