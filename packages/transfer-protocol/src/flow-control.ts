export interface FlowControlConfig {
  chunkSize: number; // Bytes per chunk (e.g. 64 * 1024)
  highWaterMark: number; // Maximum queued bytes before waiting (e.g. 1 MB)
  lowWaterMark: number; // Queue threshold to resume sending (e.g. 256 KB)
  windowSize: number; // Unacknowledged chunks allowed in-flight
}

export const DEFAULT_FLOW_CONFIG: FlowControlConfig = {
  chunkSize: 64 * 1024, // 64 KiB
  highWaterMark: 1024 * 1024, // 1 MiB
  lowWaterMark: 256 * 1024, // 256 KiB
  windowSize: 16
};

export class SpeedCalculator {
  private lastBytes = 0;
  private lastTime = Date.now();
  private smoothedSpeed = 0;

  update(currentBytes: number, totalBytes: number): { speedBps: number; etaSec: number } {
    const now = Date.now();
    const elapsedSec = (now - this.lastTime) / 1000;

    if (elapsedSec >= 0.5) {
      const bytesDiff = currentBytes - this.lastBytes;
      const currentSpeed = bytesDiff / elapsedSec;

      // Exponential moving average for smooth display
      this.smoothedSpeed = this.smoothedSpeed === 0 ? currentSpeed : 0.7 * this.smoothedSpeed + 0.3 * currentSpeed;

      this.lastBytes = currentBytes;
      this.lastTime = now;
    }

    const remainingBytes = Math.max(0, totalBytes - currentBytes);
    const etaSec = this.smoothedSpeed > 0 ? Math.ceil(remainingBytes / this.smoothedSpeed) : 0;

    return {
      speedBps: Math.round(this.smoothedSpeed),
      etaSec
    };
  }

  reset() {
    this.lastBytes = 0;
    this.lastTime = Date.now();
    this.smoothedSpeed = 0;
  }
}

