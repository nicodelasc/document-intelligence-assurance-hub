"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/primitives";

const VIEWPORT_CLEARANCE = 16;
const CALLOUT_GAP = 24;
const MOBILE_BREAKPOINT = 720;

export type GuidedTourStep = {
  targetId: string;
  title: string;
  description: string;
};

type TourGeometry = {
  mobile: boolean;
  spotlightStyle: CSSProperties;
  calloutStyle: CSSProperties;
  arrowStyle: CSSProperties;
};

type GuidedTourDialogProps = {
  overviewTitle: string;
  overviewDescription: string;
  purpose: string;
  boundary: string;
  steps: readonly GuidedTourStep[];
  getUnavailableMessage?: () => string | null;
  onClose: () => void;
};

const hiddenGeometry: TourGeometry = {
  mobile: false,
  spotlightStyle: { opacity: 0 },
  calloutStyle: {},
  arrowStyle: { opacity: 0 },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function viewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function arrowStyle(
  placement: "right" | "left" | "below" | "above",
  target: DOMRect,
  callout: { left: number; top: number; width: number; height: number },
): CSSProperties {
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  if (placement === "right") {
    const start = callout.left - 7;
    return { left: start, top: targetCenterY, width: Math.max(18, start - target.right - 7), transform: "rotate(180deg)" };
  }
  if (placement === "left") {
    const start = callout.left + callout.width + 7;
    return { left: start, top: targetCenterY, width: Math.max(18, target.left - 7 - start), transform: "rotate(0deg)" };
  }
  if (placement === "below") {
    const start = callout.top - 7;
    return { left: targetCenterX, top: start, width: Math.max(18, start - target.bottom - 7), transform: "rotate(-90deg)" };
  }
  const start = callout.top + callout.height + 7;
  return { left: targetCenterX, top: start, width: Math.max(18, target.top - 7 - start), transform: "rotate(90deg)" };
}

function targetAvailability(
  steps: readonly GuidedTourStep[],
  getUnavailableMessage?: () => string | null,
) {
  const routeMessage = getUnavailableMessage?.();
  if (routeMessage) return routeMessage;
  return steps.every((step) => document.getElementById(step.targetId))
    ? null
    : "Guided tour targets are not available yet.";
}

export function GuidedTourDialog({
  overviewTitle,
  overviewDescription,
  purpose,
  boundary,
  steps,
  getUnavailableMessage,
  onClose,
}: GuidedTourDialogProps) {
  const [mode, setMode] = useState<"overview" | "tour">("overview");
  const [stepIndex, setStepIndex] = useState(0);
  const [geometry, setGeometry] = useState<TourGeometry>(hiddenGeometry);
  const [unavailableMessage, setUnavailableMessage] = useState(() =>
    targetAvailability(steps, getUnavailableMessage));
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const closeActionRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (mode !== "overview") return;
    const refresh = () => setUnavailableMessage(targetAvailability(steps, getUnavailableMessage));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [getUnavailableMessage, mode, steps]);

  const updateGeometry = useCallback(() => {
    if (mode !== "tour") return;
    const target = document.getElementById(currentStep.targetId);
    if (!target) {
      setMode("overview");
      setUnavailableMessage("Guided tour targets are not available yet.");
      return;
    }
    const viewport = viewportBounds();
    const targetRect = target.getBoundingClientRect();
    const mobile = viewport.width <= MOBILE_BREAKPOINT;
    const padding = 6;
    const left = clamp(targetRect.left - padding, viewport.left + VIEWPORT_CLEARANCE, viewport.right - VIEWPORT_CLEARANCE);
    const top = clamp(targetRect.top - padding, viewport.top + VIEWPORT_CLEARANCE, viewport.bottom - VIEWPORT_CLEARANCE);
    const right = clamp(targetRect.right + padding, left, viewport.right - VIEWPORT_CLEARANCE);
    const bottom = clamp(targetRect.bottom + padding, top, viewport.bottom - VIEWPORT_CLEARANCE);
    const spotlightStyle: CSSProperties = {
      left,
      top,
      width: right - left,
      height: bottom - top,
      opacity: 1,
    };

    if (mobile) {
      setGeometry({ mobile: true, spotlightStyle, calloutStyle: {}, arrowStyle: { opacity: 0 } });
      return;
    }

    const surface = document.getElementById("guided-tour-callout");
    const measured = surface?.getBoundingClientRect();
    const calloutWidth = measured?.width || Math.min(360, viewport.width - VIEWPORT_CLEARANCE * 2);
    const calloutHeight = measured?.height || 250;
    const fitsRight = targetRect.right + CALLOUT_GAP + calloutWidth <= viewport.right - VIEWPORT_CLEARANCE;
    const fitsLeft = targetRect.left - CALLOUT_GAP - calloutWidth >= viewport.left + VIEWPORT_CLEARANCE;
    const fitsBelow = targetRect.bottom + CALLOUT_GAP + calloutHeight <= viewport.bottom - VIEWPORT_CLEARANCE;
    const placement = fitsRight ? "right" : fitsLeft ? "left" : fitsBelow ? "below" : "above";
    let calloutLeft = targetRect.right + CALLOUT_GAP;
    let calloutTop = targetRect.top + targetRect.height / 2 - calloutHeight / 2;
    if (placement === "left") calloutLeft = targetRect.left - CALLOUT_GAP - calloutWidth;
    else if (placement === "below") {
      calloutLeft = targetRect.left + targetRect.width / 2 - calloutWidth / 2;
      calloutTop = targetRect.bottom + CALLOUT_GAP;
    } else if (placement === "above") {
      calloutLeft = targetRect.left + targetRect.width / 2 - calloutWidth / 2;
      calloutTop = targetRect.top - CALLOUT_GAP - calloutHeight;
    }
    calloutLeft = clamp(calloutLeft, viewport.left + VIEWPORT_CLEARANCE, viewport.right - calloutWidth - VIEWPORT_CLEARANCE);
    calloutTop = clamp(calloutTop, viewport.top + VIEWPORT_CLEARANCE, viewport.bottom - calloutHeight - VIEWPORT_CLEARANCE);
    const callout = { left: calloutLeft, top: calloutTop, width: calloutWidth, height: calloutHeight };
    setGeometry({
      mobile: false,
      spotlightStyle,
      calloutStyle: { left: callout.left, top: callout.top },
      arrowStyle: arrowStyle(placement, targetRect, callout),
    });
  }, [currentStep.targetId, mode]);

  useLayoutEffect(() => {
    if (mode !== "tour") return;
    const target = document.getElementById(currentStep.targetId);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: viewportBounds().width <= MOBILE_BREAKPOINT ? "start" : "nearest",
      inline: "nearest",
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- geometry settles before paint
    updateGeometry();
  }, [currentStep.targetId, mode, updateGeometry]);

  useEffect(() => {
    if (mode !== "tour") return;
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateGeometry();
      });
    };
    const viewport = window.visualViewport;
    const target = document.getElementById(currentStep.targetId);
    const callout = document.getElementById("guided-tour-callout");
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    if (target) resizeObserver?.observe(target);
    if (callout) resizeObserver?.observe(callout);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [currentStep.targetId, mode, updateGeometry]);

  useEffect(() => {
    if (mode !== "tour") return;
    const frame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mode, stepIndex]);

  const isLastStep = stepIndex === steps.length - 1;
  return (
    <Dialog
      open
      title={mode === "overview" ? overviewTitle : currentStep.title}
      description={mode === "overview" ? overviewDescription : undefined}
      initialFocusRef={mode === "overview"
        ? (unavailableMessage ? closeActionRef : primaryActionRef)
        : undefined}
      titleRef={mode === "tour" ? stepHeadingRef : undefined}
      titleTabIndex={mode === "tour" ? -1 : undefined}
      dismissOnBackdrop={false}
      layerClassName={mode === "tour" ? "guided-tour-layer" : ""}
      surfaceClassName={mode === "tour"
        ? `guided-tour__callout guided-tour__callout--settle-${stepIndex % 2 === 0 ? "a" : "b"}${geometry.mobile ? " guided-tour__callout--mobile" : ""}`
        : "guidance-overview"}
      surfaceId={mode === "tour" ? "guided-tour-callout" : undefined}
      surfaceStyle={mode === "tour" ? geometry.calloutStyle : undefined}
      decoration={mode === "tour" ? (
        <>
          <div className="guided-tour__spotlight" style={geometry.spotlightStyle} aria-hidden="true" />
          <div className="guided-tour__arrow" style={geometry.arrowStyle} aria-hidden="true" />
        </>
      ) : undefined}
      onClose={onClose}
    >
      {mode === "overview" ? (
        <>
          <p className="guidance-overview__purpose">{purpose}</p>
          <p className="guidance-overview__boundary">{boundary}</p>
          {unavailableMessage ? <p className="guidance-overview__availability" role="status">{unavailableMessage}</p> : null}
          <div className="dialog-actions guidance-overview__actions">
            <Button ref={closeActionRef} type="button" intent="neutral" onClick={onClose}>Close</Button>
            <Button
              ref={primaryActionRef}
              type="button"
              intent="primary"
              disabled={Boolean(unavailableMessage)}
              onClick={() => {
                if (targetAvailability(steps, getUnavailableMessage)) return;
                setGeometry(hiddenGeometry);
                setStepIndex(0);
                setMode("tour");
              }}
            >
              Start guided tour
            </Button>
          </div>
        </>
      ) : (
        <div key={currentStep.targetId} className="guided-tour__settle">
          <p className="guided-tour__step-count">Step {stepIndex + 1} of {steps.length}</p>
          <p className="guided-tour__description">{currentStep.description}</p>
          <div className="guided-tour__actions">
            <Button type="button" intent="neutral" disabled={stepIndex === 0} onClick={() => {
              setGeometry(hiddenGeometry);
              setStepIndex((current) => Math.max(0, current - 1));
            }}>Back</Button>
            {isLastStep ? (
              <Button ref={primaryActionRef} type="button" intent="primary" onClick={onClose}>Finish</Button>
            ) : (
              <Button ref={primaryActionRef} type="button" intent="primary" onClick={() => {
                setGeometry(hiddenGeometry);
                setStepIndex((current) => Math.min(steps.length - 1, current + 1));
              }}>Next</Button>
            )}
          </div>
          <Button type="button" intent="ghost" className="guided-tour__exit" onClick={onClose}>Exit guided tour</Button>
        </div>
      )}
    </Dialog>
  );
}
