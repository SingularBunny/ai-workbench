# Groups

Several agents in one conversation, as in a group chat: you write, and the agents answer in turn, each from its own
role. The **Groups** page of the Control UI (the `aiwb-groups` plugin, needs **Settings → Labs → Custom plugin UI**)
lists the groups, creates and changes them, and shows the conversation.

## How a round goes

After each of your messages:

1. Agents you mention (`@garden`, or by name) answer first, in the order you mention them.
2. Then the **manager** decides who speaks next: it reads the members (their names and descriptions) and the recent
   conversation and names the agent whose role fits what is still open, or hands back to you when the question is
   answered or an agent asked you something. It does not pick the agent that just spoke unless someone asked it.
3. At most **3 agent turns** follow one message (1–6, set per group), so a group does not talk on by itself.

This is the pattern of LobeHub's group chat and AutoGen's GroupChat (a manager choosing the next speaker). Groups
are for agents with different roles, instructions and tools working on one question; for the most reliable answer
to a single question, [Multi-model](multi-model.md) is the better tool.

## What each agent sees and does

Each agent answers with a **full turn of its own**: its model, instructions, memory and tools, in its own session
for this group (`agent:<id>:aiwb-group-<group>`), so its ordinary chats are not touched. The first time it gets who
is in the group; then each turn it gets what the user and the other agents said since its last reply, each line
marked with the speaker. The manager is an agent too (Main by default): it gets a short, tool-free question.

## Groups

**New group**: pick 2–8 configured agents, the manager and the number of agent turns per message. **Change**
edits them; the conversation stays. **Stop** ends a round that is still running (the current agent's turn
finishes in its session). Groups are kept in `~/.openclaw/workbench/groups/`.

Cost: one manager question before each agent turn the manager picks, plus each agent's own turn on its own model.
