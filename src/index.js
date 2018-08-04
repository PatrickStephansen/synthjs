import "./main.css";

const initialize = () => {
  const context = new AudioContext();
  const oscillator = new OscillatorNode(context);
  const amp = new GainNode(context);

  context.suspend().then(() => {
    oscillator.connect(amp).connect(context.destination);

    const element = document.createElement("button");
    let itsOn = false;
    element.innerHTML = "make some noise";
    element.classList.add("oscillator");
    element.addEventListener("click", () => {
      if ((itsOn = !itsOn)) {
        context.resume();
        element.innerHTML = "cut that out";
      } else {
        context.suspend();
        element.innerHTML = "make some noise";
      }
    });

    document.body.appendChild(element);
    oscillator.start();
  });
};

document.addEventListener(
  "readystatechange",
  ({ target }) => target.readyState === "complete" && initialize()
);
