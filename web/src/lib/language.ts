import type { Extension } from "@codemirror/state";

export async function loadLanguageExtension(language: string): Promise<Extension | null> {
  switch (language) {
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true });
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    default:
      return null;
  }
}
