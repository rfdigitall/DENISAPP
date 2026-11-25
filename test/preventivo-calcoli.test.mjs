// Calcoli di preventivo e panoramica, estratti dal sorgente vero di index.html
// così il test si rompe se quelle funzioni cambiano senza aggiornare il comportamento.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.split('/* CALC_PREVENTIVO_START */')[1].split('/* CALC_PREVENTIVO_END */')[0];
const giorniDa = html.match(/function giorniDa\(dataIso,adesso\)\{[\s\S]*?\}function testoGiorni/)[0]
  .replace(/function testoGiorni$/, '');

const store = new Map();
const localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
};
const context = { localStorage, console };
vm.createContext(context);
vm.runInContext(giorniDa + '\n' + block, context);

const {
  numEuro, conManodopera, importoSalvatoDa, manodoperaIniziale,
  manodoperaPerRiapertura, manodoperaPreventivo, valorePreventivo, eDaRichiamare,
  memorizzaOre, oreMemorizzate,
} = context;

const oggi = new Date(2026, 10, 25); // 25 novembre 2026

function sommaPanoramica(lista) {
  return lista.reduce((s, p) => s + valorePreventivo(p), 0);
}

// 1. La somma non concatena le stringhe che a volte arrivano dal database.
assert.equal(numEuro('1200') + numEuro('340'), 1540);
assert.equal(numEuro('12,5'), 12.5);
const comeStringhe = [
  { id: 'a', stato: 'Inviato', dataIso: '2026-11-20', importo: '1200', importoManodopera: '100', carrelloSnapshot: [] },
  { id: 'b', stato: 'Accettato', dataIso: '2026-11-02', importo: '340', importoManodopera: '40', carrelloSnapshot: [] },
];
assert.equal(sommaPanoramica(comeStringhe), 1540);
assert.notEqual(String(sommaPanoramica(comeStringhe)), '01200340');

// 2. Ore con la virgola: 12,5 h × 40 € = 500, non 12 × 40.
const carrello = [{ kind: 'prodotto', prezzoUnitario: 100, qty: 1 }];
const impOre = { mode: 'ore', percent: '10', ore: '12,5', tariffa: '40' };
const soldi = importoSalvatoDa(carrello, impOre);
assert.equal(soldi.importoManodopera, 500);
assert.equal(soldi.importo, 600);

// 3. Modificare il prezzo di una riga e salvare ricalcola il totale salvato.
const dopo = importoSalvatoDa(
  [{ kind: 'prodotto', prezzoUnitario: '180,50', qty: '2' }, { kind: 'lavoro', prezzoUnitario: 20, qty: 1 }],
  impOre,
);
assert.equal(dopo.importo, Math.round(180.5 * 2 + 20 + 500));
assert.equal(dopo.importo, 881);

// 4. Riaprire non torna a 8 h × 35 €: prima la memoria, poi quanto è stato salvato.
store.clear();
memorizzaOre('PV-0200', impOre);
const senzaDiciture = { id: 'PV-0200', importo: 600, importoManodopera: 500, carrelloSnapshot: carrello, diciture: {} };
assert.equal(JSON.stringify(manodoperaPerRiapertura(senzaDiciture)), JSON.stringify({
  mode: 'ore', percent: '10', ore: '12,5', tariffa: '40',
}));
store.clear();
const salvato = {
  ...senzaDiciture,
  diciture: conManodopera({}, impOre),
};
assert.equal(manodoperaIniziale(salvato).ore, '12,5');
assert.equal(manodoperaIniziale(salvato).tariffa, '40');
assert.equal(manodoperaIniziale(salvato).mode, 'ore');
assert.notEqual(manodoperaIniziale(salvato).ore, '8');

// Un preventivo vecchio, senza ore salvate, non deve saltare a 8×35 al prossimo salvataggio:
// la percentuale si ricava dall'importo manodopera già registrato.
const vecchio = {
  id: 'PV-0100',
  importo: 1100,
  importoManodopera: 100,
  carrelloSnapshot: [{ kind: 'prodotto', prezzoUnitario: 1000, qty: 1 }],
  diciture: {},
};
const iniziale = manodoperaIniziale(vecchio);
assert.equal(iniziale.mode, 'percent');
assert.equal(Number(iniziale.percent), 10);
const ricalcolo = importoSalvatoDa(vecchio.carrelloSnapshot, iniziale);
assert.equal(ricalcolo.importoManodopera, 100);
assert.equal(ricalcolo.importo, 1100);

// 5. Panoramica: niente doppio conteggio, niente rifiutati, "da richiamare" solo se già inviato.
const preventivi = [
  { id: 'inv', stato: 'Inviato', dataIso: '2026-11-01', importo: '1000', importoManodopera: '0', carrelloSnapshot: [
    { kind: 'prodotto', prezzoUnitario: 200, qty: 4 },
  ], diciture: conManodopera({}, { mode: 'percent', percent: '10', ore: '8', tariffa: '35' }) },
  { id: 'att', stato: 'In Attesa', dataIso: '2026-11-01', importo: 300, importoManodopera: 30, carrelloSnapshot: [] },
  { id: 'rif', stato: 'Rifiutato', dataIso: '2026-11-01', importo: 9999, importoManodopera: 800, carrelloSnapshot: [] },
  { id: 'fin', stato: 'Finito', dataIso: '2026-11-10', importo: 400, importoManodopera: 40, carrelloSnapshot: [] },
  { id: 'oggi', stato: 'Inviato', dataIso: '2026-11-25', importo: 50, importoManodopera: 0, carrelloSnapshot: [] },
];
// 200×4 = 800, +10% = 880. Non 800+80+80 e non l'importo vecchio 1000.
assert.equal(valorePreventivo(preventivi[0]), 880);
assert.equal(manodoperaPreventivo(preventivi[0]), 80);
const validi = preventivi.filter(p => p.stato !== 'Rifiutato');
const aperti = preventivi.filter(p => p.stato !== 'Finito' && p.stato !== 'Rifiutato');
assert.equal(sommaPanoramica(aperti), 880 + 300 + 50);
assert.equal(validi.reduce((s, p) => s + manodoperaPreventivo(p), 0), 80 + 30 + 40);
assert.equal(eDaRichiamare(preventivi[0], oggi), true);
assert.equal(eDaRichiamare(preventivi[1], oggi), false);
assert.equal(eDaRichiamare(preventivi[4], oggi), false);

// 6. Andare avanti e indietro non perde le ore: restano nello stato e, se la pagina
//    viene smontata, si rileggono dalla memoria del preventivo.
let ore = '6';
let tariffa = '45';
let passo = 2;
function vai(nuovoPasso) { passo = nuovoPasso; }
vai(3);
ore = '15,5';
tariffa = '42';
memorizzaOre('PV-0300', { mode: 'ore', percent: '10', ore, tariffa });
vai(2);
vai(3);
assert.equal(passo, 3);
assert.equal(ore, '15,5');
assert.equal(tariffa, '42');
ore = '8';
tariffa = '35';
const riaperto = manodoperaPerRiapertura({ id: 'PV-0300', diciture: {}, carrelloSnapshot: [], importo: 0, importoManodopera: 0 });
assert.equal(riaperto.ore, '15,5');
assert.equal(riaperto.tariffa, '42');
assert.equal(oreMemorizzate('PV-0300').mode, 'ore');

console.log('preventivo-calcoli: ok');
