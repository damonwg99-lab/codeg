import { fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "./workbench-route-context"

function Probe() {
  const { routeId, isConversations, setRoute, openConversations } =
    useWorkbenchRoute()
  return (
    <div>
      <span data-testid="route">{routeId}</span>
      <span data-testid="isConv">{String(isConversations)}</span>
      <button onClick={() => setRoute("automations")}>go</button>
      <button onClick={openConversations}>back</button>
    </div>
  )
}

describe("WorkbenchRouteProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it("defaults to the conversation workspace and switches routes", () => {
    const { getByTestId, getByText } = render(
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    )
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(getByTestId("isConv").textContent).toBe("true")

    fireEvent.click(getByText("go"))
    expect(getByTestId("route").textContent).toBe("automations")
    expect(getByTestId("isConv").textContent).toBe("false")

    // Desktop: the conversation column coexists with the workbench right zone,
    // so openConversations() must NOT clear the focused workbench tab (that
    // would drop the right zone onto the empty "open a file or diff" hint).
    fireEvent.click(getByText("back"))
    expect(getByTestId("route").textContent).toBe("automations")
  })

  it("mobile: openConversations returns to the conversation workspace", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const { getByTestId, getByText } = render(
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    )

    fireEvent.click(getByText("go"))
    expect(getByTestId("route").textContent).toBe("automations")

    fireEvent.click(getByText("back"))
    expect(getByTestId("route").textContent).toBe("conversations")
    expect(getByTestId("isConv").textContent).toBe("true")
  })

  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/WorkbenchRouteProvider/)
    spy.mockRestore()
  })
})
