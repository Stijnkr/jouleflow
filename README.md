# Jouleflow ⚡

**Open-source energiemanagementsysteem voor je huis.**

Jouleflow verbindt de energieapparaten in je huis, slaat hun data op en laat die zien in overzichtelijke live en historische grafieken. Na verloop van tijd leert het hoe jouw huis energie gebruikt en stuurt het apparaten bij op basis van je tarief en je voorkeuren.

> 🚧 **In ontwikkeling.** Het uitlezen van de slimme meter, de geschiedenis en de kostenberekening werken al. Het aansturen van apparaten volgt later. Geef het project een ster of volg de repo om op de hoogte te blijven.

## Wat Jouleflow gaat doen

- 🔌 **Meerdere apparaten koppelen:** slimme meter (P1), omvormers van zonnepanelen, thuisbatterijen, warmtepompen, laadpalen en meer
- 💾 **Je energiedata opslaan**, lokaal en in een vorm waar je iets mee kunt
- 📈 **Live en historische grafieken** in een strakke webapp, op computer, tablet en telefoon
- 💶 **Kosten inzichtelijk** met je eigen contract, voor **vaste** en later ook **dynamische** tarieven
- 🧠 **Je huis leren kennen:** verbruikspatronen herkennen en verbruik en zonne-opbrengst voorspellen
- 🔋 **Batterij en zonnepanelen bijsturen:** laden, ontladen of afschakelen op de juiste momenten
- 🕒 **Tijdvensters:** aangeven wanneer je energie wilt gebruiken of wanneer apparaten mogen draaien
- 🏠 **Werkt lokaal.** Je data blijft in je eigen huis.

## Hardware

Jouleflow draait nu op een **Raspberry Pi**.
Later komt er **eigen open hardware** met ingebouwde I/O (P1, Modbus/RS-485, relais, enz.) voor een eenvoudige plug-and-play-installatie.

## Aan de slag

Jouleflow leest de P1-poort op dit moment uit via een lezer met ESPHome, zoals de [SlimmeLezer](https://www.zuidwijk.com/product/slimmelezer-plus/).

Op een Raspberry Pi met [uv](https://docs.astral.sh/uv/) en Node.js 20.19+:

```bash
git clone https://github.com/Stijnkr/jouleflow.git
cd jouleflow
./deploy/install.sh
```

Open daarna `http://<jouw-pi>.local` en ga naar:
- **Instellingen → P1-meter** om je meter te koppelen
- **Instellingen → Energiecontract** om je tarieven in te vullen

### Bijwerken

```bash
cd jouleflow && git pull && ./deploy/install.sh
```

### Ontwikkelen

```bash
cd backend && uv sync && uv run pytest        # backend + tests
JOULEFLOW_P1_URL=http://<ip-van-lezer> uv run jouleflow

cd frontend && npm install && npm run dev      # webapp met hot reload, stuurt /api door
```

De webapp is standaard Nederlandstalig en kan in de instellingen op Engels worden gezet. Teksten staan in `frontend/src/locales/`.

## Roadmap

### Fase 1: P1-meter & datafundament
- [x] De Nederlandse/Belgische slimme meter uitlezen via de P1-poort (DSMR, via ESPHome-lezers)
- [x] Metingen betrouwbaar en efficiënt opslaan (ruwe data + samengevatte geschiedenis)
- [x] Webapp met **live** grafieken van vermogen en energie
- [x] **Geschiedenis** per dag, week, maand en jaar
- [x] Draait op een Raspberry Pi
- [ ] Directe ondersteuning voor een USB P1-kabel
- [ ] Data exporteren (CSV)

### Fase 2: Tarieven & inzicht 👈 *huidige focus*
- [x] Energiecontracten met vaste tarieven (normaal/dal, salderen, teruglevertarieven, vaste kosten, gas)
- [x] Energiekosten per uur, dag, maand en jaar
- [x] Instellingen voor de P1-meter met keuze uit verschillende typen meters
- [x] Nederlandstalige interface (met Engels als optie)
- [ ] Dynamische (uur)tarieven
- [ ] Drivers voor HomeWizard P1 en USB P1-kabel
- [x] Koppeling met omvormers van zonnepanelen (Growatt MIC/MIN via Modbus TCP)

### Fase 3: Je huis leren kennen
- [ ] Verbruikspatronen en verbruiksvoorspelling
- [ ] Voorspelling van zonne-opbrengst

### Fase 4: Aansturen
- [ ] Thuisbatterij aansturen
- [ ] Zonnepanelen afschakelen bij negatieve prijzen
- [ ] Zelf in te stellen tijdvensters en voorkeuren
- [ ] Slimme planning op basis van tarieven, voorspellingen en voorkeuren

### Fase 5: Meer apparaten & eigen hardware
- [ ] Warmtepompen, laadpalen en andere apparaten
- [ ] Integratie met Home Assistant
- [ ] Eigen Jouleflow-hardware met ingebouwde I/O

## Bijdragen

Ideeën, vragen en feedback zijn welkom. Open een issue of start een gesprek in [Discussions](https://github.com/Stijnkr/jouleflow/discussions).

Werk je met een AI-codeeragent? In [AGENTS.md](AGENTS.md) staan de afspraken en de technische stack.

## Licentie

Jouleflow valt onder de [Apache License 2.0](LICENSE). Zie [NOTICE](NOTICE) voor de naamsvermelding.

De naam "Jouleflow" en het logo vallen niet onder deze licentie. Je mag de code vrij gebruiken, aanpassen en verspreiden, maar noem je fork of product alsjeblieft niet "Jouleflow".

## ⚠️ Disclaimer

Jouleflow stuurt echte elektrische apparatuur aan. Gebruik is op eigen risico. Volg altijd de veiligheidsvoorschriften van de fabrikant van je apparatuur.
