import { clamp, mergeDeepRight, path } from 'ramda';
import { fromEvent } from 'rxjs';
import { map, tap } from 'rxjs/operators';

const defaultOptions = {
  min: -1,
  max: 1,
  step: 0.001,
  label: '',
  value: 0.25
};

let elementNumber = 0;

export class NumericInputControl {
  constructor(options) {
    options = mergeDeepRight(defaultOptions, options);
    this.htmlElement = document.createElement('div');
    this.htmlElement.classList.add('numeric-input-control');
    this.id = options.id || `numeric-input-${elementNumber++}`;
    this.max = options.max;
    this.min = options.min;
    this.htmlElement.innerHTML = `
      <label for="${this.id}">${options.label}</label>
      <input
        type="number"
        id="${this.id}"
        max="${options.max}"
        min="${options.min}"
        step="${options.step}">`;
    this.inputElement = this.htmlElement.lastChild;
    this.setValue(options.value);
    this.change$ = fromEvent(this.inputElement, 'input').pipe(
      map(path(['target', 'value'])),
      map(value => {
        this.setValue(value);
      }),
      map(() => this.value)
    );
  }

  setValue(newValue) {
    if (isFinite(newValue)) {
      this.value = clamp(this.min, this.max, newValue);
      this.inputElement.value = this.value;
    }
  }
}
