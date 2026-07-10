import { Show } from "solid-js";
import ImageViewer from "./ImageViewer";
import { fileRawUrl, fileBlobUrl, type GitFileStatus } from "../api";

export default function ImageDiffView(props: {
  projectId: string;
  path: string;
  status: GitFileStatus;
  mtimeMs: number | null;
}) {
  const showBefore = () => props.status !== "?" && props.status !== "A";
  const showAfter = () => props.status !== "D";
  const single = () => !(showBefore() && showAfter());

  return (
    <div class="image-diff" classList={{ "image-diff-single": single() }}>
      <Show when={showBefore()}>
        <figure class="image-diff-side">
          <figcaption class="image-diff-label muted">before (HEAD)</figcaption>
          <ImageViewer src={fileBlobUrl(props.projectId, props.path, "HEAD")} alt="before" />
        </figure>
      </Show>
      <Show when={showAfter()}>
        <figure class="image-diff-side">
          <figcaption class="image-diff-label muted">after (working tree)</figcaption>
          <ImageViewer
            src={fileRawUrl(props.projectId, props.path, props.mtimeMs ?? 0)}
            alt="after"
          />
        </figure>
      </Show>
    </div>
  );
}
