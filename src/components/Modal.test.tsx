import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import Modal from "./Modal";

describe("Modal", () => {
  it("calls onClose when the dark backdrop is clicked", () => {
    const onClose = vi.fn();

    render(() => (
      <Modal open={true} onClose={onClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    ));

    const backdrop = screen.getByLabelText("Close").closest("div.fixed")?.querySelector("div.absolute.inset-0");
    expect(backdrop).toBeTruthy();

    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when clicking inside the modal content", () => {
    const onClose = vi.fn();

    render(() => (
      <Modal open={true} onClose={onClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    ));

    const content = screen.getByText("Modal content");
    fireEvent.click(content);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();

    render(() => (
      <Modal open={true} onClose={onClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    ));

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders subtitle when provided", () => {
    render(() => (
      <Modal open={true} onClose={() => {}} title="Test Modal" subtitle="Test Subtitle">
        <p>Modal content</p>
      </Modal>
    ));

    expect(screen.getByText("Test Subtitle")).toBeTruthy();
  });

  it("does not render subtitle element when subtitle is not provided", () => {
    render(() => (
      <Modal open={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    ));

    const title = screen.getByText("Test Modal");
    const header = title.closest("div.flex-1.min-w-0");
    expect(header).toBeTruthy();
    expect(header!.querySelector("p")).toBeFalsy();
  });
});
