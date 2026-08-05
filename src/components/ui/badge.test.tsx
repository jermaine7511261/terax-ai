// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Badge } from "./badge";

describe("Badge", () => {
  it("renders with the default variant", () => {
    render(<Badge>Hello</Badge>);

    const el = screen.getByText("Hello");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-slot", "badge");
    expect(el).toHaveAttribute("data-variant", "default");
    expect(el).toHaveClass("bg-primary");
  });

  it("applies the destructive variant class", () => {
    render(<Badge variant="destructive">Error</Badge>);

    const el = screen.getByText("Error");
    expect(el).toHaveAttribute("data-variant", "destructive");
    expect(el.className).toContain("bg-destructive/10");
  });

  it("applies the outline variant class", () => {
    render(<Badge variant="outline">Outline</Badge>);

    const el = screen.getByText("Outline");
    expect(el).toHaveAttribute("data-variant", "outline");
    expect(el.className).toContain("border-border");
  });

  it("renders as a child element when asChild is set", () => {
    render(
      <Badge asChild>
        <a href="#">Link</a>
      </Badge>,
    );

    const el = screen.getByRole("link");
    expect(el).toHaveAttribute("data-slot", "badge");
  });
});
