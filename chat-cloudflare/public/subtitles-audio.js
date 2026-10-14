// Integrating resampler: carries fractional input sample weight across render
// quanta, downmixes to mono and emits PCM16LE at exactly 16 kHz (no audio playback).
class SubtitleCapture extends AudioWorkletProcessor {
  constructor() { super(); this.remaining = sampleRate / 16000; this.sum = 0; this.ratio = sampleRate / 16000; this.data = []; this.live = true;
    this.port.onmessage = e => { if (e.data === 'flush') { this.flush(); this.live = false; this.port.postMessage({ flushed: true }); } }; }
  flush() { if (!this.data.length) return; const bytes = new ArrayBuffer(this.data.length * 2), view = new DataView(bytes); let peak = 0;
    this.data.forEach((v, i) => { peak = Math.max(peak, Math.abs(v)); view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true); });
    this.data = []; this.port.postMessage({ pcm: bytes, peak }, [bytes]); }
  process(inputs) {
    if (!this.live) return false; const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      const sample = channels.reduce((n, c) => n + c[i], 0) / channels.length; let weight = 1;
      while (weight > 1e-8) { const take = Math.min(weight, this.remaining); this.sum += sample * take; this.remaining -= take; weight -= take;
        if (this.remaining < 1e-8) { this.data.push(this.sum / this.ratio); this.sum = 0; this.remaining = this.ratio; } }
      if (this.data.length >= 8000) this.flush();
    } return true;
  }
}
registerProcessor('subtitle-capture', SubtitleCapture);
