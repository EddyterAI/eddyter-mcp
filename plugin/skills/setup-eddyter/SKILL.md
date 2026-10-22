---
name: setup-eddyter
description: Add the Eddyter AI rich text editor to a React, Next.js, Vite or Remix app. Use when the user wants to install, integrate, embed or set up Eddyter, or asks to add a rich text editor to their project.
---

# Add Eddyter to a project

Goal: a working Eddyter editor in the user's app, with the license key in an env file, in as few steps as possible. The user may not be a frontend expert, so explain each step in one plain sentence and avoid jargon.

## 1. Check the license

Call `verify_status`.

- **Valid:** note the plan and continue.
- **No key or invalid key:** tell the user to create or renew a key at https://www.eddyter.com/user/license-key and reconnect the Eddyter connector. You can still prepare the code, but the editor will show an auth error until the key works.
- **Warning (expiring soon, payment issue):** mention it once, briefly, then continue.

## 2. Detect the framework

If a project is open, read `package.json` and the folder layout:

| What you find | Framework value |
| --- | --- |
| `next` dependency and an `app/` or `src/app/` folder | `nextjs-app` |
| `next` dependency with only `pages/` or `src/pages/` | `nextjs-pages` |
| `@remix-run/react` or another `@remix-run/*` package | `remix` |
| `vite` with `react` | `vite` |
| `react-scripts`, or React without the above | `react` |

If both `app/` and `pages/` exist, use `nextjs-app` unless the user says otherwise.

If the project is not React-based (Vue, Svelte, Angular, plain HTML), tell the user this guided setup covers React, Next.js, Vite and Remix, and point them to the Eddyter docs at https://eddyter.com/docs for their framework.

If no project is open (for example, in a chat without file access), ask which framework they use.

## 3. Get the official setup code

Call `get_integration_snippet` with the framework value. Treat its output as the source of truth. Do not write the editor setup from memory: the client-only (no server rendering) boundary is the part that most often goes wrong, and the snippet gets it right.

## 4. Apply it

When you can edit files:

1. **Fit the project layout.** If the project keeps code under `src/`, put the components there (for example `src/components/Editor.tsx`) and fix import paths. If the project has no TypeScript, save files as `.jsx`, and remove the `!` non-null assertions and `as any` casts.
2. **Never overwrite.** If a file with the same name exists, use a different name (for example `EddyterEditor.tsx`) and tell the user.
3. **Install the package** with the project's package manager: `pnpm add eddyter` if there is a `pnpm-lock.yaml`, `yarn add eddyter` for `yarn.lock`, `bun add eddyter` for `bun.lockb` or `bun.lock`, otherwise `npm install eddyter`. Remix also needs `remix-utils`.
4. **Add the env variable** to the env file the snippet names, with a placeholder value. Make sure that env file is listed in `.gitignore` (add it if missing). Never write the user's real key into a file that will be committed. Tell the user to paste their key from https://www.eddyter.com/user/license-key and to restart the dev server afterwards.
5. **Show the editor on a page.** Ask where it should appear if the user hasn't said, then render the component from the snippet there (for the Next.js App Router, render `<EditorClient />`).

When you cannot edit files, give the user numbered copy-paste steps in this order: install command, env line, each file with its path, where to render it.

## 5. Check it works

If you can run commands, run the project's type check or build. Then tell the user what to expect: the editor appears on the page, and `onChange` currently logs the HTML to the console. Offer to replace that with their own save logic (for example, saving to their API or form state).

## 6. Offer next steps

Briefly offer to:

- show which editor features are on and turn any on or off (the `manage-eddyter` skill), or
- connect `onChange` to how they store content.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `window is not defined` or `document is not defined` during build | The editor is being rendered on the server. Load it through the `dynamic(..., { ssr: false })` or `ClientOnly` wrapper from the snippet. |
| Editor shows an auth error | The env variable is missing, misnamed or the dev server wasn't restarted. Next.js needs the `NEXT_PUBLIC_` prefix and Vite needs `VITE_`. Run `verify_status` to confirm the key itself is valid. |
| Editor has no styling | `import 'eddyter/style.css'` is missing from the editor component. |
| Remix: key is undefined | Expose `EDDYTER_API_KEY` to the browser through the root loader's `window.ENV`, as the snippet notes describe. |
