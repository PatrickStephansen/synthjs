import { NumericInputControl } from './numeric-input-control';
import { distinctUntilChanged } from 'rxjs/operators';

export class GainControl {
  constructor(audioContext, options) {
    this.subscriptions = [];
    this.audioNode = new GainNode(audioContext, options);
    this.audioContext = audioContext;
    this.htmlElement = document.createElement('div');
    this.htmlElement.classList.add('gain-control');
    this.inputControl = new NumericInputControl({
      min: 0,
      max: 1,
      step: 0.001,
      value: this.audioNode.gain.value,
      label: 'Gain'
    });
    this.htmlElement.appendChild(this.inputControl.htmlElement);

    this.subscriptions.push(
      this.inputControl.change$.pipe(distinctUntilChanged()).subscribe(newGain => {
        this.audioNode.gain.value = newGain;
      })
    );
  }

  setGain(newGain) {
    this.inputControl.setValue(newGain);
    this.audioNode.gain.cancelScheduledValues(this.audioNode.context.currentTime);
    this.audioNode.gain.value = this.inputControl.value;
  }

  startEnvelope({ a, d, s }, amplitudeScalingFactor) {
    this.audioNode.gain.cancelScheduledValues(this.audioNode.context.currentTime);

    this.audioNode.gain.setTargetAtTime(
      a.amplitude * amplitudeScalingFactor,
      this.audioNode.context.currentTime,
      a.time / 4
    );
    this.audioNode.gain.setTargetAtTime(
      s.amplitude * amplitudeScalingFactor,
      this.audioNode.context.currentTime + a.time,
      d.time / 4
    );

    this.inputControl.setValue(a.amplitude * amplitudeScalingFactor);
  }

  endEnvelope({ r }) {
    this.audioNode.gain.cancelAndHoldAtTime(this.audioNode.context.currentTime);
    this.audioNode.gain.setTargetAtTime(0, this.audioNode.context.currentTime, r.time / 4);
    this.inputControl.setValue(0);
  }
}
