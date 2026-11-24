/**
 * Canonical, copy-paste integration snippets for the `eddyter` package.
 *
 * The editor is a CLIENT-ONLY React component (it runs Lexical against the DOM
 * and ships no "use client" / SSR guard itself). So every server-rendered
 * framework here loads it behind an SSR-safe boundary — this is the #1 thing a
 * plain LLM gets wrong, and the reason this tool exists.
 */

export type Framework =
  | "react"
  | "nextjs-app"
  | "nextjs-pages"
  | "vite"
  | "remix";

export interface SnippetFile {
  path: string;
  action: "create" | "modify";
  content: string;
}

export interface IntegrationSnippet {
  framework: Framework;
  installCommand: string;
  env: { file: string; varName: string; line: string };
  files: SnippetFile[];
  notes: string[];
}

const INSTALL = "npm install eddyter";

const baseEditor = (envExpr: string) => `import {
  ConfigurableEditorWithAuth,
  EditorProvider,
} from 'eddyter';
import 'eddyter/style.css';

export default function Editor() {
  return (
    <EditorProvider>
      <ConfigurableEditorWithAuth
        apiKey={${envExpr}}
        onChange={(html) => console.log(html)}
        onAuthError={(e) => console.error('Eddyter auth failed:', e)}
      />
    </EditorProvider>
  );
}
`;

const PLACEHOLDER_KEY = "your_key_here";

/**
 * @param licenseKey  the caller's real key (client config or OAuth session). When
 *   given it is written into the env line so the editor authenticates on first run;
 *   otherwise the placeholder stays and the notes say where to get a key.
 */
export function getIntegrationSnippet(framework: Framework, licenseKey?: string): IntegrationSnippet {
  const s = buildSnippet(framework);
  if (licenseKey) {
    s.env.line = `${s.env.varName}=${licenseKey}`;
  } else {
    s.notes.push("Get your key at https://www.eddyter.com/user/license-key");
  }
  // The key is public at runtime (the browser sends it) and bound to one domain —
  // this is hygiene, not secrecy.
  s.notes.push(`The key goes in ${s.env.file}; make sure that file is in .gitignore.`);
  return s;
}

function buildSnippet(framework: Framework): IntegrationSnippet {
  switch (framework) {
    case "react":
    case "vite": {
      const isVite = framework === "vite";
      const varName = isVite
        ? "VITE_EDDYTER_API_KEY"
        : "REACT_APP_EDDYTER_API_KEY";
      const envExpr = isVite
        ? "import.meta.env.VITE_EDDYTER_API_KEY"
        : "process.env.REACT_APP_EDDYTER_API_KEY";
      return {
        framework,
        installCommand: INSTALL,
        env: { file: ".env", varName, line: `${varName}=${PLACEHOLDER_KEY}` },
        files: [
          { path: "src/components/Editor.tsx", action: "create", content: baseEditor(envExpr + "!") },
        ],
        notes: [
          "Import <Editor /> wherever you want the editor.",
          "No SSR boundary needed — this is a client-rendered app.",
        ],
      };
    }

    case "nextjs-app": {
      const varName = "NEXT_PUBLIC_EDDYTER_API_KEY";
      return {
        framework,
        installCommand: INSTALL,
        env: { file: ".env.local", varName, line: `${varName}=${PLACEHOLDER_KEY}` },
        files: [
          {
            path: "components/Editor.tsx",
            action: "create",
            content: `'use client';\n\n` + baseEditor("process.env.NEXT_PUBLIC_EDDYTER_API_KEY!"),
          },
          {
            path: "components/EditorClient.tsx",
            action: "create",
            content: `'use client';

import dynamic from 'next/dynamic';

// Load the editor with SSR disabled — it is a client-only (DOM) component.
const Editor = dynamic(() => import('./Editor'), { ssr: false });

export default function EditorClient() {
  return <Editor />;
}
`,
          },
        ],
        notes: [
          "Render <EditorClient /> from any App Router page (server or client).",
          "ssr:false is required — the editor touches the DOM and will crash if server-rendered.",
        ],
      };
    }

    case "nextjs-pages": {
      const varName = "NEXT_PUBLIC_EDDYTER_API_KEY";
      return {
        framework,
        installCommand: INSTALL,
        env: { file: ".env.local", varName, line: `${varName}=${PLACEHOLDER_KEY}` },
        files: [
          { path: "components/Editor.tsx", action: "create", content: baseEditor("process.env.NEXT_PUBLIC_EDDYTER_API_KEY!") },
          {
            path: "pages/editor.tsx",
            action: "create",
            content: `import dynamic from 'next/dynamic';

// Disable SSR — the editor is a client-only (DOM) component.
const Editor = dynamic(() => import('../components/Editor'), { ssr: false });

export default function EditorPage() {
  return <Editor />;
}
`,
          },
        ],
        notes: [
          "Visit /editor, or import the dynamic Editor into any page.",
          "ssr:false is required for the Pages Router too.",
        ],
      };
    }

    case "remix": {
      const varName = "EDDYTER_API_KEY";
      return {
        framework,
        installCommand: INSTALL,
        env: { file: ".env", varName, line: `${varName}=${PLACEHOLDER_KEY}` },
        files: [
          {
            path: "app/components/Editor.client.tsx",
            action: "create",
            // `.client.tsx` keeps this out of the server bundle in Remix.
            content: baseEditor("(window as any).ENV?.EDDYTER_API_KEY"),
          },
          {
            path: "app/routes/editor.tsx",
            action: "create",
            content: `import { ClientOnly } from 'remix-utils/client-only';
import Editor from '~/components/Editor.client';

export default function EditorRoute() {
  // ClientOnly ensures the DOM-only editor never renders on the server.
  return <ClientOnly fallback={null}>{() => <Editor />}</ClientOnly>;
}
`,
          },
        ],
        notes: [
          "The `.client.tsx` suffix + ClientOnly keep the editor off the server.",
          "Expose EDDYTER_API_KEY to the client via your root loader's window.ENV, or use a public env strategy.",
          "`remix-utils` provides ClientOnly: npm install remix-utils",
        ],
      };
    }
  }
}

/** Compact, agent-readable rendering of a snippet. */
export function renderSnippet(s: IntegrationSnippet): string {
  const files = s.files
    .map(
      (f) =>
        `--- ${f.action.toUpperCase()} ${f.path} ---\n${f.content}`,
    )
    .join("\n");
  return [
    `Framework: ${s.framework}`,
    ``,
    `1) Install:\n   ${s.installCommand}`,
    ``,
    `2) Env (${s.env.file}):\n   ${s.env.line}`,
    ``,
    `3) Files:`,
    files,
    ``,
    `Notes:`,
    s.notes.map((n) => `  • ${n}`).join("\n"),
  ].join("\n");
}
