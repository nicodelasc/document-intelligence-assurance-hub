"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { workbenchTourSteps } from "./guided-tour-config";

const VIEWPORT_CLEARANCE = 16;
const CALLOUT_GAP = 24;
const MOBILE_BREAKPOINT = 720;

type TourGeometry = {
  mobile: boolean;
  spotlightStyle: CSSProperties;
  calloutStyle: CSSProperties;
  arrowStyle: CSSProperties;
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
    const end = target.right + 7;
    return {
      left: start,
      top: targetCenterY,
      width: Math.max(18, start - end),
      transform: "rotate(180deg)",
    };
  }
  if (placement === "left") {
    const start = callout.left + callout.width + 7;
    const end = target.left - 7;
    return {
      left: start,
      top: targetCenterY,
      width: Math.max(18, end - start),
      transform: "rotate(0deg)",
    };
  }
  if (placement === "below") {
    const start = callout.top - 7;
    const end = target.bottom + 7;
    return {
      left: targetCenterX,
      top: start,
      width: Math.max(18, start - end),
      transform: "rotate(-90deg)",
    };
  }
  const start = callout.top + callout.height + 7;
  const end = target.top - 7;
  return {
    left: targetCenterX,
    top: start,
    width: Math.max(18, end - start),
    transform: "rotate(90deg)",
  };
}

export function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"overview" | "tour">("overview");
  const [stepIndex, setStepIndex] = useState(0);
  const [geometry, setGeometry] = useState<TourGeometry>(hiddenGeometry);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentStep = workbenchTourSteps[stepIndex];

  const updateGeometry = useCallback(() => {
    if (mode !== "tour") return;
    const target = document.getElementById(currentStep.targetId);
    if (!target) return;
    const viewport = viewportBounds();
    const targetRect = target.getBoundingClientRect();
    const mobile = viewport.width <= MOBILE_BREAKPOINT;
    const spotlightPadding = 6;
    const spotlightLeft = clamp(
      targetRect.left - spotlightPadding,
      viewport.left + VIEWPORT_CLEARANCE,
      viewport.right - VIEWPORT_CLEARANCE,
    );
    const spotlightTop = clamp(
      targetRect.top - spotlightPadding,
      viewport.top + VIEWPORT_CLEARANCE,
      viewport.bottom - VIEWPORT_CLEARANCE,
    );
    const spotlightRight = clamp(
      targetRect.right + spotlightPadding,
      spotlightLeft,
      viewport.right - VIEWPORT_CLEARANCE,
    );
    const spotlightBottom = clamp(
      targetRect.bottom + spotlightPadding,
      spotlightTop,
      viewport.bottom - VIEWPORT_CLEARANCE,
    );
    const spotlightStyle: CSSProperties = {
      left: spotlightLeft,
      top: spotlightTop,
      width: spotlightRight - spotlightLeft,
      height: spotlightBottom - spotlightTop,
      opacity: 1,
    };

    if (mobile) {
      setGeometry({
        mobile: true,
        spotlightStyle,
        calloutStyle: {},
        arrowStyle: { opacity: 0 },
      });
      return;
    }

    const surface = document.getElementById("workbench-guided-tour-callout");
    const measured = surface?.getBoundingClientRect();
    const calloutWidth = measured?.width
      ? measured.width
      : Math.min(360, viewport.width - VIEWPORT_CLEARANCE * 2);
    const calloutHeight = measured?.height || 250;
    const fitsRight = targetRect.right + CALLOUT_GAP + calloutWidth <= viewport.right - VIEWPORT_CLEARANCE;
    const fitsLeft = targetRect.left - CALLOUT_GAP - calloutWidth >= viewport.left + VIEWPORT_CLEARANCE;
    const fitsBelow = targetRect.bottom + CALLOUT_GAP + calloutHeight <= viewport.bottom - VIEWPORT_CLEARANCE;
    const placement = fitsRight
      ? "right"
      : fitsLeft
        ? "left"
        : fitsBelow
          ? "below"
          : "above";
    let calloutLeft = targetRect.right + CALLOUT_GAP;
    let calloutTop = targetRect.top + targetRect.height / 2 - calloutHeight / 2;
    if (placement === "left") {
      calloutLeft = targetRect.left - CALLOUT_GAP - calloutWidth;
    } else if (placement === "below") {
      calloutLeft = targetRect.left + targetRect.width / 2 - calloutWidth / 2;
      calloutTop = targetRect.bottom + CALLOUT_GAP;
    } else if (placement === "above") {
      calloutLeft = targetRect.left + targetRect.width / 2 - calloutWidth / 2;
      calloutTop = targetRect.top - CALLOUT_GAP - calloutHeight;
    }
    calloutLeft = clamp(
      calloutLeft,
      viewport.left + VIEWPORT_CLEARANCE,
      viewport.right - calloutWidth - VIEWPORT_CLEARANCE,
    );
    calloutTop = clamp(
      calloutTop,
      viewport.top + VIEWPORT_CLEARANCE,
      viewport.bottom - calloutHeight - VIEWPORT_CLEARANCE,
    );
    const callout = {
      left: calloutLeft,
      top: calloutTop,
      width: calloutWidth,
      height: calloutHeight,
    };
    setGeometry({
      mobile: false,
      spotlightStyle,
      calloutStyle: { left: callout.left, top: callout.top },
      arrowStyle: arrowStyle(placement, targetRect, callout),
    });
  }, [currentStep.targetId, mode]);

  useEffect(() => {
    if (mode !== "tour") return;
    const target = document.getElementById(currentStep.targetId);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target?.scrollIntoView?.({
      behavior: reducedMotion ? "auto" : "smooth",
      block: viewportBounds().width <= MOBILE_BREAKPOINT ? "start" : "nearest",
      inline: "nearest",
    });
  }, [currentStep.targetId, mode]);

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
    const callout = document.getElementById("workbench-guided-tour-callout");
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (target) resizeObserver?.observe(target);
    if (callout) resizeObserver?.observe(callout);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();
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

  const isLastStep = stepIndex === workbenchTourSteps.length - 1;
  const close = () => onClose();

  return (
    <Dialog
      open
      title={mode === "overview" ? "What this workbench does" : currentStep.title}
      description={mode === "overview"
        ? "See how document evidence becomes a reviewable business decision."
        : undefined}
      initialFocusRef={mode === "overview" ? primaryActionRef : undefined}
      titleRef={mode === "tour" ? stepHeadingRef : undefined}
      titleTabIndex={mode === "tour" ? -1 : undefined}
      dismissOnBackdrop={false}
      layerClassName={mode === "tour" ? "guided-tour-layer" : ""}
      surfaceClassName={mode === "tour"
        ? `guided-tour__callout guided-tour__callout--settle-${stepIndex % 2 === 0 ? "a" : "b"}${geometry.mobile ? " guided-tour__callout--mobile" : ""}`
        : "guidance-overview"}
      surfaceId={mode === "tour" ? "workbench-guided-tour-callout" : undefined}
      surfaceStyle={mode === "tour" ? geometry.calloutStyle : undefined}
      decoration={mode === "tour" ? (
        <>
          <div className="guided-tour__spotlight" style={geometry.spotlightStyle} aria-hidden="true" />
          <div className="guided-tour__arrow" style={geometry.arrowStyle} aria-hidden="true" />
        </>
      ) : undefined}
      onClose={close}
    >
      {mode === "overview" ? (
        <>
          <p className="guidance-overview__purpose">
            This workbench checks document evidence against reference data then explains what needs attention and prepares safe next-step options for a reviewer.
          </p>
          <p className="guidance-overview__boundary">
            It does not approve payment or update a live business system.
          </p>
          <div className="dialog-actions guidance-overview__actions">
            <Button type="button" intent="neutral" onClick={close}>Close</Button>
            <Button
              ref={primaryActionRef}
              type="button"
              intent="primary"
              onClick={() => {
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
          <p className="guided-tour__step-count">Step {stepIndex + 1} of {workbenchTourSteps.length}</p>
          <p className="guided-tour__description">{currentStep.description}</p>
          <div className="guided-tour__actions">
            <Button
              type="button"
              intent="neutral"
              disabled={stepIndex === 0}
              onClick={() => {
                setGeometry(hiddenGeometry);
                setStepIndex((current) => Math.max(0, current - 1));
              }}
            >
              Back
            </Button>
            {isLastStep ? (
              <Button ref={primaryActionRef} type="button" intent="primary" onClick={close}>Finish</Button>
            ) : (
              <Button
                ref={primaryActionRef}
                type="button"
                intent="primary"
                onClick={() => {
                  setGeometry(hiddenGeometry);
                  setStepIndex((current) => Math.min(workbenchTourSteps.length - 1, current + 1));
                }}
              >
                Next
              </Button>
            )}
          </div>
          <Button type="button" intent="ghost" className="guided-tour__exit" onClick={close}>
            Exit guided tour
          </Button>
        </div>
      )}
    </Dialog>
  );
}
