---
name: manage-eddyter
description: Check an Eddyter account's license, plan and AI credit usage, and turn Eddyter editor features (AI chat, tables, comments, image upload, exports and more) on or off live. Use when the user asks about their Eddyter plan, expiry, credits or enabled features, or wants to change what their editor offers.
---

# Manage Eddyter

Feature changes go live immediately for every user of the editor on this license key, with no redeploy. Be clear about what will change before changing it.

## Answer account questions (read-only)

| The user asks | Call | Then |
| --- | --- | --- |
| Is my key valid? Which plan? When does it expire? | `verify_status` | Give status, plan and days left. Flag any warning. |
| How many credits do I have? Am I near my limit? | `get_usage` | Give credits remaining, used this period and days until reset. If BYOK mode is on, explain that their own AI provider keys are used and credits are not consumed. |
| Which features are on? | `get_config` | Group into **On**, **Off (can be turned on)** and **Locked (needs a plan upgrade)**. |

Summarise in plain words and lead with what matters (expiring soon, low credits, payment warnings). Show the raw tool output only if the user asks.

## Change features

1. **Call `get_config` first** to see the current state and what the plan allows.
2. **Map the user's words to feature keys** using the table below.
3. **Locked features:** don't try to enable them. Explain the feature isn't in their plan and that they can upgrade from their Eddyter account at https://www.eddyter.com.
4. **State the change before making it**, in one line, for example: "This turns off AI chat and tables for everyone using your editor, right away." If the user named the exact features, go ahead. If you are inferring features from a vague request (for example "make the editor simpler"), list your proposed changes and wait for a yes.
5. **Call `update_config`** with only the keys that change, under `toolbarOptions`:

   ```json
   { "toolbarOptions": { "enableAIChat": false, "enableTableOptions": false } }
   ```

6. **Report the result** from the tool's response: what is now on and off. If a feature didn't change, it is limited by the plan; say so.

## Feature keys

| Feature | Key |
| --- | --- |
| AI chat | `enableAIChat` |
| Text formatting (bold, italic, underline) | `enableTextFormatting` |
| Tables | `enableTableOptions` |
| Image upload | `enableImageUpload` |
| Comments | `enableComments` |
| @mentions | `enableMentions` |
| Charts | `enableCharts` |
| Embeds (YouTube, Loom and similar) | `enableEmbeds` |
| PDF export | `enablePdfExport` |
| DOC export | `enableDocExport` |
| Speech to text | `enableSpeechToText` |
| Headings | `enableHeadings` |
| Lists | `enableLists` |
| Text and background colors | `enableColors` |
| Callout / note panels | `enableNotePanels` |
| To-do lists | `enableTodoList` |
| Format painter | `enableFormatPainter` |

`get_config` may list other features. Their key is `enable` followed by the label in PascalCase (for example, "Code blocks" becomes `enableCodeBlocks`).

## Common requests

- **"Stop using AI credits" / "turn off AI":** set `enableAIChat` to `false`.
- **"Let my team collaborate":** turn on `enableComments` and `enableMentions`.
- **"Let users export documents":** turn on `enablePdfExport` and `enableDocExport`.

## If something goes wrong

| Problem | What to tell the user |
| --- | --- |
| Eddyter tools are not available | Connect the Eddyter connector (or reinstall the plugin) and sign in with their Eddyter account. |
| "No active license key found" | Create a key at https://www.eddyter.com/user/license-key, then reconnect. |
| A change didn't take effect | The feature is locked by their plan. Run `get_config` to show what the plan allows. |
