/** A cancelled request must also cancel its delayed restart. */
export class AiRequestRetry {
  private timer: ReturnType<typeof setTimeout> | undefined;

  schedule(callback: () => void, delay: number, isCurrent: () => boolean = () => true): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (isCurrent()) callback();
    }, delay);
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
