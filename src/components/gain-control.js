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
    this.audioNode.gain.value = this.inputElement.value;
  }
}
