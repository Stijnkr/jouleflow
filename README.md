# Jouleflow ⚡

**Open-source energy management system for your home.**
Jouleflow steers your home battery, heat pump and EV charger based on solar production and dynamic energy prices, so you use more of your own energy and pay less for the rest.

> 🚧 **Early development.** Jouleflow is not ready for use yet. Star or watch the repo to follow along.

## Goals

- **Smart scheduling:** charge, discharge and run devices when energy is cheap or abundant
- **Dynamic pricing:** support for day-ahead / hourly tariffs
- **Solar-aware:** use forecasts to maximise self-consumption
- **Hardware-agnostic:** pluggable drivers for inverters, batteries, heat pumps, EV chargers and P1 meters
- **Home Assistant integration**, and also runs standalone
- **Simulation mode:** try strategies safely without touching real hardware

## Roadmap

- [ ] Core architecture and device driver interface
- [ ] P1 meter and dynamic price sources
- [ ] First battery / inverter driver
- [ ] Scheduling / optimisation engine
- [ ] Web dashboard
- [ ] Home Assistant integration
- [ ] Docker image

## Contributing

Ideas, questions and feedback are welcome. Open an issue or start a thread in [Discussions](https://github.com/Stijnkr/jouleflow/discussions).

## License

Jouleflow is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

The name "Jouleflow" and its logo are not covered by this license. You're free to use, modify and redistribute the code, but please don't name your fork or product "Jouleflow".

## ⚠️ Disclaimer

Jouleflow controls real electrical equipment. Use at your own risk and always follow your hardware manufacturer's safety guidelines.
