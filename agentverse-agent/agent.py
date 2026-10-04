import json
import os
from datetime import datetime
from uuid import uuid4

import requests
from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents.experimental.chat_agent.protocol import build_llm_message_history
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)


APP_API_BASE_URL = os.environ["APP_API_BASE_URL"].rstrip("/")
APP_API_TOKEN = os.environ["APP_API_TOKEN"]
client = OpenAI(base_url=os.environ["ASI1_BASE_URL"], api_key=os.environ["ASI1_API_KEY"])

SYSTEM_PROMPT = """You are the Conditional Escrow agent in a Solana Devnet demo.
Use your tools to inspect conditions, create verification plans, and run public evidence checks.
Use the returned application state as the source of truth. Distinguish observed evidence from conclusions;
never claim that public snippets prove a real-world fact. The app stores document metadata only and does not
read uploaded file contents. Run evidence checks only when the user explicitly asks you to run or verify them.
You have no tool to create/fund a deal, sign a transaction, or release funds. Never claim that funds moved.
Settlement remains a separate user-confirmed Devnet action in the application."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_conditions",
            "description": "List recent escrow conditions and their current status.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_condition",
            "description": "Get a condition, its verification checks, evidence, document metadata, and linked Devnet deal status.",
            "parameters": {
                "type": "object",
                "properties": {"condition_id": {"type": "string", "description": "The condition ID from the app."}},
                "required": ["condition_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_condition",
            "description": "Create a condition in the app and generate/save its verification plan. Use when the user asks to define a new escrow condition.",
            "parameters": {
                "type": "object",
                "properties": {"condition": {"type": "string", "description": "The condition that must be verified."}},
                "required": ["condition"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_verification",
            "description": "Run the saved public-source checks for a condition, store their evidence/results, and update its status. This can take time and uses configured search and model services. Call only after the user explicitly asks to run verification.",
            "parameters": {
                "type": "object",
                "properties": {"condition_id": {"type": "string", "description": "The condition ID to verify."}},
                "required": ["condition_id"],
                "additionalProperties": False,
            },
        },
    },
]


def app_request(method: str, path: str, body: dict | None = None) -> dict:
    response = requests.request(
        method,
        f"{APP_API_BASE_URL}{path}",
        headers={"Authorization": f"Bearer {APP_API_TOKEN}"},
        json=body,
        timeout=100,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": "The app returned an unreadable response."}
    if not response.ok:
        raise RuntimeError(payload.get("error", f"App request failed ({response.status_code})."))
    encoded = json.dumps(payload, ensure_ascii=False)
    if len(encoded) > 18_000:
        return {"truncated": True, "data": encoded[:18_000]}
    return payload


def dispatch_tool(name: str, arguments: dict) -> dict:
    if name == "list_conditions":
        return app_request("GET", "/api/agent/conditions")
    if name == "get_condition":
        condition_id = str(arguments["condition_id"])
        if not condition_id.isdigit():
            raise ValueError("Condition ID must be numeric.")
        return app_request("GET", f"/api/agent/conditions/{condition_id}")
    if name == "create_condition":
        condition = str(arguments["condition"]).strip()
        if not condition or len(condition) > 2000:
            raise ValueError("Condition must be between 1 and 2,000 characters.")
        return app_request("POST", "/api/agent/conditions", {"condition": condition})
    if name == "run_verification":
        condition_id = str(arguments["condition_id"])
        if not condition_id.isdigit():
            raise ValueError("Condition ID must be numeric.")
        return app_request("POST", f"/api/agent/conditions/{condition_id}", {"action": "run_verification"})
    raise ValueError(f"Unknown tool: {name}")


def answer_with_tools(messages: list[dict]) -> str:
    for _ in range(5):
        completion = client.chat.completions.create(
            model="asi1",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=1400,
        )
        message = completion.choices[0].message
        if not message.tool_calls:
            return (message.content or "I couldn't produce a response. Please try again.").strip()

        messages.append(message.model_dump(exclude_none=True))
        for tool_call in message.tool_calls:
            try:
                arguments = json.loads(tool_call.function.arguments or "{}")
                result = dispatch_tool(tool_call.function.name, arguments)
                content = json.dumps(result, ensure_ascii=False)
            except Exception as error:
                content = json.dumps({"error": str(error)}, ensure_ascii=False)
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": content})
    return "I hit the tool-call limit for this turn. Please ask me to continue."


def create_text_chat(text: str, end_session: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.utcnow(), msg_id=uuid4(), content=content)


agent = Agent()
protocol = Protocol(spec=chat_protocol_spec)


@protocol.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(), acknowledged_msg_id=msg.msg_id))
    if not msg.text():
        return
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *build_llm_message_history(ctx),
    ]
    try:
        response = answer_with_tools(messages)
    except Exception:
        ctx.logger.exception("Conditional Escrow agent failed to process a turn")
        response = "I couldn't complete that request. Check the agent and app logs, then try again."
    await ctx.send(sender, create_text_chat(response))


@protocol.on_message(ChatAcknowledgement)
async def handle_acknowledgement(_ctx: Context, _sender: str, _msg: ChatAcknowledgement):
    pass


agent.include(protocol, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
