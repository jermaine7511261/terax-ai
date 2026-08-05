// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Switch } from "./switch";

describe("Switch", () => {
  it("renders a switch element", () => {
    render(<Switch />);

    const el = screen.getByRole("switch");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-slot", "switch");
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("calls onCheckedChange when toggled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reflects controlled checked state", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch checked onCheckedChange={onCheckedChange} />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    rerender(<Switch checked={false} onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("applies the size data attribute", () => {
    render(<Switch size="sm" />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-size", "sm");
  });
});
