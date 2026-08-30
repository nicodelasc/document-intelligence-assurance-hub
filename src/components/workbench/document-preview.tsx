/* eslint-disable @next/next/no-img-element -- local object URLs cannot use the Next image optimizer */
import { FileText } from "lucide-react";
import { EmptyState, RulePanel } from "@/components/ui/primitives";
import type { SyntheticFixture } from "@/domain/types";
import type { CustomUploadState } from "./workbench-controls";

function LocalFilePreview({
  custom,
  previewUrl,
}: {
  custom: CustomUploadState;
  previewUrl: string;
}) {
  if (!custom.file) {
    return (
      <EmptyState title="Choose a local file">
        The file remains local until consented submission.
      </EmptyState>
    );
  }
  if (custom.file.type.startsWith("image/") && previewUrl) {
    return (
      <img
        className="document-preview__image"
        src={previewUrl}
        alt={`Local preview of ${custom.file.name}`}
      />
    );
  }
  if (custom.file.type === "application/pdf" && previewUrl) {
    return (
      <iframe
        className="document-preview__iframe"
        src={previewUrl}
        title={`Local document preview for ${custom.file.name}`}
      />
    );
  }
  return (
    <div className="pdf-fallback">
      <FileText aria-hidden="true" />
      <h3>{custom.file.name}</h3>
      <p>Preparing the local document preview…</p>
    </div>
  );
}

export function DocumentPreview(props: {
  source: "synthetic" | "custom";
  fixture: SyntheticFixture;
  custom: CustomUploadState;
  previewUrl: string;
}): React.JSX.Element {
  const { source, fixture, custom, previewUrl } = props;

  if (source === "custom") {
    return (
      <RulePanel
        className="document-preview"
        title="Document preview"
        action={
          custom.file && previewUrl ? (
            <a href={previewUrl} target="_blank" rel="noreferrer">
              Open full document
            </a>
          ) : null
        }
      >
        <div className="document-preview__frame">
          <LocalFilePreview custom={custom} previewUrl={previewUrl} />
        </div>
      </RulePanel>
    );
  }

  const fixtureUrl = `/samples/${fixture.filename}`;
  const renderedPreviewUrl = fixtureUrl.replace(/\.pdf$/i, ".png");
  return (
    <RulePanel
      className="document-preview"
      title="Document preview"
      action={
        <a href={fixtureUrl} target="_blank" rel="noreferrer">
          Open full document
        </a>
      }
    >
      <div className="document-preview__layout">
        <div className="document-preview__frame">
          <img
            className="document-preview__image"
            src={renderedPreviewUrl}
            alt={`Rendered preview of ${fixture.title}`}
          />
        </div>
        <aside
          className="difference-panel"
          aria-labelledby="difference-panel-title"
        >
          <h3 id="difference-panel-title">What changed</h3>
          <ul>
            {fixture.differenceSummary.map((difference) => (
              <li key={difference}>{difference}</li>
            ))}
          </ul>
        </aside>
      </div>
    </RulePanel>
  );
}
