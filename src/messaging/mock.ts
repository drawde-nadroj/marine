export type MockMessageResult = {
  status: "SIMULATED" | "FAILED";
  error?: string;
};
export class MockMessageAdapter {
  send(body: string): MockMessageResult {
    return body.includes("DEMO_FAIL_MESSAGE")
      ? { status: "FAILED", error: "DEMO-ONLY injected mock boundary failure" }
      : { status: "SIMULATED" };
  }
}
