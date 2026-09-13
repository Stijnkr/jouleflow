# Jouleflow ⚡

**Open-source energy management system for your home.**

Jouleflow connects the energy devices in your home, stores their data, and shows it in clear live and historical charts. Over time it learns how your home uses energy and steers devices based on your tariff and your preferences.

> 🚧 **Early development.** Jouleflow is not ready for use yet. Star or watch the repo to follow along.

## What Jouleflow will do

- 🔌 **Connect multiple devices:** smart meter (P1), solar inverters, home batteries, heat pumps, EV chargers and more
- 💾 **Store your energy data** locally, in a form that's useful for analysis
- 📈 **Live and historical charts** in a clean web app, on desktop, tablet and phone
- 🧠 **Learn your home:** recognise your usage patterns and predict consumption and solar production
- 💶 **Tariff-aware control** for both **fixed** and **dynamic** (hourly / day-ahead) energy contracts
- 🔋 **Steer your battery and solar:** charge, discharge or curtail at the right moments
- 🕒 **Time windows:** tell Jouleflow when you want energy to be available or when devices may run
- 🏠 **Runs locally.** Your data stays in your home.

## Hardware

Jouleflow currently runs on a **Raspberry Pi**.
Later we plan to build **dedicated open hardware** with built-in I/O (P1, Modbus/RS-485, relays, etc.) for easy, plug-and-play installation.

## Roadmap

### Phase 1: P1 meter & data foundation 👈 *current focus*
- [ ] Read the Dutch/Belgian smart meter via the P1 port (DSMR)
- [ ] Store readings reliably and efficiently (raw data + aggregated history)
- [ ] Web app with **live** power and energy charts
- [ ] **History** view (day / week / month / year)
- [ ] Runs on a Raspberry Pi

### Phase 2: Tariffs & insight
- [ ] Fixed and dynamic tariff support
- [ ] Energy costs per hour / day / month
- [ ] Solar inverter integration

### Phase 3: Learning your home
- [ ] Usage patterns and consumption forecasting
- [ ] Solar production forecasting

### Phase 4: Control
- [ ] Home battery control
- [ ] Solar curtailment
- [ ] User-defined time windows and preferences
- [ ] Optimised scheduling based on tariffs, forecasts and preferences

### Phase 5: More devices & own hardware
- [ ] Heat pumps, EV chargers and other devices
- [ ] Home Assistant integration
- [ ] Dedicated Jouleflow hardware with built-in I/O

## Contributing

Ideas, questions and feedback are welcome. Open an issue or start a thread in [Discussions](https://github.com/Stijnkr/jouleflow/discussions).

Working with an AI coding agent? See [AGENTS.md](AGENTS.md) for project conventions and the technical stack.

## License

Jouleflow is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

The name "Jouleflow" and its logo are not covered by this license. You're free to use, modify and redistribute the code, but please don't name your fork or product "Jouleflow".

## ⚠️ Disclaimer

Jouleflow controls real electrical equipment. Use at your own risk and always follow your hardware manufacturer's safety guidelines.
