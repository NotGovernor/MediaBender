import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import GuidelinesPage from "./GuidelinesPage";
import { setWorkQueue } from "../stores/appStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("GuidelinesPage help sidebar", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("displays a note about fixed output-format rules", () => {
    render(() => <GuidelinesPage />);

    expect(
      screen.getByText(/fixed output-format instructions/i)
    ).toBeDefined();
    expect(
      screen.getByText(/appended to the system prompt automatically/i)
    ).toBeDefined();
    expect(
      screen.getByText(/not shown here and cannot be edited/i)
    ).toBeDefined();
  });
});
