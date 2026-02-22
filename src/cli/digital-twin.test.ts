import { describe, expect, it } from "vitest"

import { createDigitalTwinProvider, MockDigitalTwinProvider } from "./digital-twin"
import { DEFAULT_ARC_CONFIG } from "./config"

describe("digital twin", () => {
  it("creates mock environments with scoped endpoints", async () => {
    const provider = new MockDigitalTwinProvider("http://localhost:8787")
    const env = await provider.provision({
      attempt: 3,
      objective: "test objective",
    })

    expect(env.id).toContain("mock-3")
    expect(env.endpoint).toContain("/twin/")
  })

  it("uses command provider when command configured", async () => {
    const provider = createDigitalTwinProvider({
      ...DEFAULT_ARC_CONFIG,
      digitalTwin: {
        ...DEFAULT_ARC_CONFIG.digitalTwin,
        enabled: true,
        command:
          'node -e "process.stdout.write(JSON.stringify({id:\'cmd-1\',endpoint:\'http://twin.local\',metadata:{kind:\'cmd\'}}))"',
      },
    })

    const env = await provider.provision({
      attempt: 5,
      objective: "command objective",
    })

    expect(env.id).toBe("cmd-1")
    expect(env.endpoint).toBe("http://twin.local")
    expect(env.metadata.kind).toBe("cmd")
  })
})
