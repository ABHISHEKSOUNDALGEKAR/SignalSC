/** Single-flight operations with invalidation across sign-out/unmount. */
export class TaskGate {
  private active: AbortController | null = null;
  begin() {
    if (this.active) return null;
    const controller = new AbortController();
    this.active = controller;
    return { signal: controller.signal, current: () => this.active === controller && !controller.signal.aborted,
      finish: () => { if (this.active === controller) this.active = null; } };
  }
  cancel() { this.active?.abort(); this.active = null; }
}
