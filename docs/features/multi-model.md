# Multi-model

Several models answer the same question and their answers are shown side by side. A judge model then picks the
most consistent answer, or one model merges them into a single answer. The **Multi-model** page of the Control UI
(the `aiwb-compare` plugin, needs **Settings → Labs → Custom plugin UI**) sets the roles and has a "Try it" box.

## Roles

| Role | Default ("auto") | What it does |
|---|---|---|
| Answering models | the top free models, one per family, by their [Arena](https://arena.ai) text rating; 3, or 2–6 | answer the question, all at once |
| Judge | the strongest rated reasoning model of a family none of the answering models is from | picks the most consistent answer |
| Merger | the judge | writes one answer from all of them |
| Default model | the judge | the model to continue with |

Models come from every provider OpenClaw has (`models.list`). "Free" means an OpenRouter `:free` model, or any
model of a provider listed as free in `freeProviders` (a local Ollama, say). Free models change every week, so
nothing is fixed in advance: the page ranks the current catalog by the current Arena rating. The rating is the
official Arena dataset on Hugging Face (`lmarena-ai/leaderboard-dataset`), refreshed once a day and kept on disk
(`~/.openclaw/workbench/arena-text.json`); when the refresh fails the saved one is used and the page says so. A
model Arena does not list has no rating and comes after the rated ones.

**Free models fail often.** In a live run on 11.11.2026 none of the three best rated free models answered: one
was not available in the region the request came from, one hit the free tier's rate limit, one put its whole answer
in its reasoning and returned no text. So a model that fails is replaced by the next free model of a family that
is not answering yet (the answer card says which model it replaced and why), and a failed model is not suggested
again for 30 minutes (a day for one that answers only in its reasoning; the table marks it "failed recently").

Choose **manual** to tick the answering models yourself, or pick a judge, merger or default model by name. Saving
the roles needs an `operator.admin` connection.

## Picking the most consistent answer

The judge gets all answers and names the one most consistent with the others (Universal Self-Consistency, Chen et
al., 2023). A judge tends to prefer an answer by its position, by its length and by its own model family, so:

- the judge is from another family than the answering models;
- it chooses twice, the second time with the answers in reverse order. Both times the same answer: that one is
  marked **most consistent**. Two different answers: **no clear agreement**, and the judge's notes say why.

**Merge** writes a new answer from all of them. It can lose an answer that was right where the others were wrong,
so it is a separate button and marked a synthesis.

## Cost

A question costs one call per answering model; picking adds two judge calls, merging one call. Free models cost
nothing but have rate limits; a judge on a Claude subscription counts against its limits. The page shows the
count before you ask.

## Settings

`plugins.entries.aiwb-compare.config`: `answerers` (`mode` auto or manual, `count`, `models`), `judge`, `merger`,
`defaultModel` (`"auto"` or a model as `provider/id`), `freeProviders`, `maxTokens` (2048). The installer allows
the plugin to call the models it names (`plugins.entries.aiwb-compare.llm.allowModelOverride`). A model that
runs on a CLI (Claude by subscription) is called through OpenClaw's isolated agent runtime, the others directly.
