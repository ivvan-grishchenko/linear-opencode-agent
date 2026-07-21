import type { AgentSessionEventWebhookPayload } from '@linear/sdk';

import { Injectable } from '@nestjs/common';

import type { OpenSpecChange } from '../agent-session.type';
import type { IAgentSessionPromptService } from '../interface';

@Injectable()
export class AgentSessionPromptService implements IAgentSessionPromptService {
	buildDelegationPrompt(webhook: AgentSessionEventWebhookPayload, change: OpenSpecChange): string {
		const { issue } = webhook.agentSession;
		const identifier = issue?.identifier ?? 'UNKNOWN';
		const title = issue?.title ?? 'Untitled issue';
		const promptContext = webhook.promptContext ?? '';

		return `You are a coding agent working on the repository in your working directory.
An issue has been assigned to you. Implement it and open a pull request.

## Issue
Identifier: ${identifier}
Title: ${title}

${promptContext}

## OpenSpec change
This issue is bound to OpenSpec change \`${change.name}\`.
The spec above, in the issue description, is the source of truth.

## Workflow
1. Read the spec in the issue description above to understand the intended change.
2. Create a branch: \`git checkout -b ${change.branchName}\`
   If the branch already exists, check it out with \`git checkout ${change.branchName}\`.
3. Implement the change following the spec.
4. Run tests / typecheck / lint as appropriate for this repo.
5. Commit your changes with a clear message referencing ${identifier}.
6. Push and open a PR (follow the conventional commits guidelines:
   \`gh pr create --title "feat: ${change.name}" --body "Implements ${change.name}. Closes ${identifier}."\`
7. Report the PR URL in your final response.

Do not push directly to the main branch. Always work on \`${change.branchName}\`.
	Be concise in your progress messages but thorough in implementation.
`;
	}

	buildMentionPrompt(webhook: AgentSessionEventWebhookPayload): string {
		const promptContext = webhook.promptContext ?? '';
		const commentBody = webhook.agentSession.comment?.body ?? '';

		return `You are a code-aware assistant helping with a question about the repository
in your working directory. A user mentioned you in a comment on a Linear issue.

## Issue context
${promptContext}

## The user's question
${commentBody}

## Instructions
Investigate the relevant code before answering. Use file search, read files,
and run grep to verify your claims against the actual code. Cite file paths
and line numbers in your answer.

This is a read-only consultation. Do not edit files, commit, push, or create
branches. Answer the user's question concisely and concretely with code references.
`;
	}
}
