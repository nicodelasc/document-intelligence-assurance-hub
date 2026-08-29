"use client";

import { useRef, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type {
  DocumentFamily,
  SyntheticFixture,
  VariantClassification,
} from "@/domain/types";

const familyDefinitions: ReadonlyArray<{
  id: DocumentFamily;
  label: string;
}> = [
  { id: "supplier_invoice", label: "Supplier invoices" },
  { id: "warehouse_goods_receipt", label: "Warehouse goods receipts" },
];

const classificationLabels: Record<VariantClassification, string> = {
  correct: "Correct",
  attention: "Needs attention",
  incorrect: "Incorrect",
};

function ClassificationIcon({
  classification,
}: {
  classification: VariantClassification;
}) {
  if (classification === "correct") {
    return <CheckCircle2 aria-hidden="true" />;
  }
  if (classification === "attention") {
    return <AlertTriangle aria-hidden="true" />;
  }
  return <XCircle aria-hidden="true" />;
}

export function FixtureLibrary(props: {
  fixtures: readonly SyntheticFixture[];
  selectedId: string;
  onSelect: (fixtureId: string) => void;
  onUpload: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const {
    fixtures,
    selectedId,
    onSelect,
    onUpload,
    disabled = false,
  } = props;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedId);
  const activeFamily = selectedFixture?.family ?? familyDefinitions[0].id;
  const familyFixtures = fixtures.filter(
    (fixture) => fixture.family === activeFamily,
  );

  function activateFamily(index: number) {
    const family = familyDefinitions[index];
    const firstFixture = fixtures.find(
      (fixture) => fixture.family === family.id,
    );
    if (!firstFixture) return;
    onSelect(firstFixture.id);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = familyDefinitions.findIndex(
      (family) => family.id === activeFamily,
    );
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % familyDefinitions.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + familyDefinitions.length) %
        familyDefinitions.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = familyDefinitions.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    activateFamily(nextIndex);
  }

  return (
    <div className="fixture-library">
      <div className="fixture-family-tabs" role="tablist" aria-label="Document families">
        {familyDefinitions.map((family, index) => {
          const selected = family.id === activeFamily;
          return (
            <button
              key={family.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`fixture-family-tab-${family.id}`}
              aria-controls={`fixture-family-panel-${family.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => activateFamily(index)}
              onKeyDown={handleTabKeyDown}
            >
              {family.label}
            </button>
          );
        })}
      </div>

      <div
        id={`fixture-family-panel-${activeFamily}`}
        className="fixture-family-panel"
        role="tabpanel"
        aria-labelledby={`fixture-family-tab-${activeFamily}`}
        tabIndex={0}
      >
        <div className="fixture-variant-list">
          {familyFixtures.map((fixture) => {
            const selected = fixture.id === selectedId;
            return (
              <button
                key={fixture.id}
                type="button"
                className="fixture-tile"
                data-testid="fixture-variant"
                data-classification={fixture.classification}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelect(fixture.id)}
              >
                <span className="fixture-tile__heading">
                  <strong>{fixture.variantLabel}</strong>
                  <span className="fixture-classification">
                    <ClassificationIcon classification={fixture.classification} />
                    {classificationLabels[fixture.classification]}
                  </span>
                </span>
                <small>{fixture.title}</small>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={`fixture-upload-tile${selectedFixture ? "" : " selected-control"}`}
          aria-label="+ Add your document"
          aria-pressed={!selectedFixture}
          disabled={disabled}
          onClick={onUpload}
        >
          <strong>+ Add your document</strong>
          <small>PDF, PNG or JPG · Maximum 3 MB</small>
        </button>
      </div>
    </div>
  );
}
