# Orchestrator Workflow

## intake_request

Capture the user request, normalize artifact references, and identify any explicit workflow cues.

## classify_intent

Map the request to the closest supported `intent_id` using the intent-routing matrix. If no direct match exists, select the nearest safe redirect intent.

## clarify_if_needed

Check required inputs for the selected intent. If required context is missing, ask focused clarification questions and pause before specialist dispatch.

## dispatch_specialists

Invoke the primary specialist (and supporting specialists when needed) with scoped context, required artifacts, and an explicit output contract.

## synthesize_single_response

Combine specialist outputs into a `single_final_response` that preserves evidence boundaries, uncertainty notes, and recommended next action.

## offer_next_action

Offer the most relevant next workflow step (or safe redirect) based on current evidence completeness and user goal.
