// =============================================
// Isi teks Section 2 "TOEFL Practice Test 2" (Structure & Written Expression,
// soal 1-40) hasil transkripsi dari lembar soal, plus mengganti Reading no. 39
// yang di buku aslinya berupa pilihan gambar diagram.
//
// Kunci jawaban Structure TIDAK diubah (sudah dari seed-toefl-practice2-key.js);
// script ini hanya UPDATE prompt + opsi, jadi aman dijalankan berulang.
//
// Written Expression: bagian yang bergaris bawah di buku ditandai dengan huruf
// dalam kurung tepat setelah frasanya, mis. "Much(A) superstitions(B) ...".
//   node -r dotenv/config scripts/import-toefl-practice2-structure.js
// =============================================

const { pool, query } = require('../src/config/database');
const { ensureToeflTables } = require('../src/utils/toefl');

const TITLE = 'TOEFL Practice Test 2';

// --- Section 2, bagian Structure (kalimat rumpang) ---------------------------
const STRUCTURE = [
  [1, 'In 1793, Charles Newbold designed a cast iron plow that ______ than the wooden plows then in use.',
    'was more efficient', 'was of more efficiency', 'had more efficiency', 'it was more efficient'],
  [2, '______ think of metallurgy as a modern field of science, but it is actually one of the oldest.',
    'Although many people', 'Many people', 'Many people who', 'In spite of many people'],
  [3, "Part of Jane Colden's work involved collecting plant specimens, cataloging plants, and ______ with other botanists.",
    'exchanging correspondence', 'her exchange of correspondence', 'correspondence exchanging', 'correspondence was exchanged'],
  [4, 'The walls of arteries ______ into three layers.',
    'they divide', 'dividing', 'to be divided', 'are divided'],
  [5, 'The art of storytelling is ______ humanity.',
    'as old', 'old as', 'as old as', 'old'],
  [6, 'A cloud is a dense mass of ______ water vapor or ice particles.',
    'or', 'whether', 'both', 'either'],
  [7, 'Centuries of erosion have exposed ______ rock surfaces in the Painted Desert of northern Arizona.',
    'rainbow-colored', 'colored like a rainbow', 'in colors of the rainbow', "a rainbow's coloring"],
  [8, 'Nellie Ross of Wyoming was the first woman ______ governor in the United States.',
    'who elected', 'to be elected', 'was elected', 'her election as'],
  [9, 'Dry farming is a type of agriculture used in areas ______ less than 20 inches of rainfall.',
    'there are', 'in which is', 'where there is', 'which has'],
  [10, 'Once known as the "Golden State" because of its gold mines, ______.',
    'North Carolina today mines few metallic minerals',
    'few metallic minerals are mined in North Carolina today',
    'there are few metallic minerals mined in North Carolina today',
    'today in North Carolina few metallic minerals are mined'],
  [11, 'Indoor heating systems have made ______ for people to live and work comfortably in temperate climates.',
    'possible that', 'it possible', 'possible', 'it is possible'],
  [12, '______ of liquids through pipes.',
    'The flow controlled by valves', 'For valves to control the flow', 'Valves control the flow', 'Controlled by valves, the flow'],
  [13, 'Honey is the only form of naturally occurring sugar that ______ to be refined before it can be eaten.',
    'has not', 'does not have', 'not having', 'does not'],
  [14, '______ species of wild goats, only one, the Rocky Mountain goat, is native to North America.',
    'The ten', 'Ten of the', 'Of the ten', 'There are ten'],
  [15, 'Snare drums produce a sharp, rattling sound ______.',
    'as striking', 'when are struck', 'struck', 'when struck'],
];

// --- Section 2, bagian Written Expression (cari bagian yang salah) -----------
const WRITTEN = [
  [16, 'Much(A) superstitions(B) and symbols are(C) connected with(D) Halloween.',
    'Much', 'superstitions', 'are', 'with'],
  [17, 'Luray Caverns in northern(A) Virginia contain acres(B) of colorful(C) rock formations illumination(D) by electric lights.',
    'northern', 'acres', 'colorful', 'illumination'],
  // BELUM PASTI: kunci resmi = C, tapi pada transkripsi ini C ("sometimes")
  // justru sudah benar — batas garis bawah di scan tidak terbaca jelas.
  // Perlu dicocokkan dengan buku aslinya sebelum simulasi ini dinilai serius.
  [18, 'Furniture makers use glue to hold(A) joints together(B) and sometimes(C) to reinforce it(D).',
    'to hold', 'together', 'sometimes', 'it'],
  [19, 'Anthracite contains(A) a higher(B) percent(C) of carbon(D) than bituminous coal.',
    'contains', 'higher', 'percent', 'carbon'],
  [20, 'Sheep have been(A) domesticated(B) for over(C) 5,000 years ago(D).',
    'have been', 'domesticated', 'for over', 'years ago'],
  [21, 'The hard, out(A) surface of(B) the tooth is called(C) enamel(D).',
    'out', 'of', 'is called', 'enamel'],
  [22, 'Aneroid barometers are(A) smaller than(B) mercury barometers and are more easy(C) to carry(D).',
    'are', 'than', 'more easy', 'to carry'],
  [23, 'Liquids take the shape(A) of any container which in(B) they(C) are placed(D).',
    'the shape', 'which in', 'they', 'are placed'],
  [24, 'The earliest form of artificial(A) lighting was(B) fire, which also(C) provided warm(D) and protection.',
    'artificial', 'was', 'also', 'warm'],
  // Kunci resmi = C, dan satu-satunya kesalahan di kalimat ini adalah
  // "editorials staffs" (harusnya "editorial staffs"), jadi label digeser supaya
  // huruf C jatuh tepat di bagian yang salah.
  [25, 'Publishers of modern encyclopedias employ(A) hundreds(B) of specialists and large editorials(C) staffs(D).',
    'employ', 'hundreds', 'editorials', 'staffs'],
  [26, 'Automobiles begun(A) to be equipped with(B) built-in(C) radios around(D) 1930.',
    'begun', 'with', 'built-in', 'around'],
  [27, 'The thread used in(A) knitting may be(B) woolen yarn, cotton, or(C) synthetic fabric threads such rayon(D).',
    'in', 'may be', 'or', 'such rayon'],
  // Kunci resmi = C. Kesalahannya: anak kalimat kehilangan subjek + to be
  // ("but it is not always evident"), jadi C menandai tempat sisipan itu.
  [28, 'All mammals have(A) hair, but(B) not always(C) evident(D).',
    'have', 'but', 'not always', 'evident'],
  [29, 'Asparagus grows well(A) in soil that is(B) too much(C) salty for most(D) crops to grow.',
    'well', 'that is', 'too much', 'most'],
  [30, 'A professor(A) of economic(B) and history at Atlanta University, W. E. B. Du Bois promoted full(C) racial equality(D).',
    'A professor', 'economic', 'full', 'equality'],
  [31, 'Bubbles of(A) air in ice cream make it(B) soft and enough smooth(C) to eat(D).',
    'of', 'make it', 'enough smooth', 'to eat'],
  [32, 'However(A) type of raw materials(B) are used in making(C) paper, the process is essentially the same(D).',
    'However', 'materials', 'in making', 'the same'],
  [33, 'Ducks are less(A) susceptible to(B) infection than another(C) types of poultry(D).',
    'less', 'to', 'another', 'poultry'],
  [34, "Lake Tahoe's great deep(A) of 1,600 feet(B) prevents it(C) from freezing in(D) the winter.",
    'deep', 'feet', 'it', 'in'],
  [35, 'By(A) 1675, Boston was the home port(B) for almost 750 ships, ranging in size(C) between 30 to 250(D) tons.',
    'By', 'home port', 'ranging in size', 'between 30 to 250'],
  [36, 'The silk(A) thread that spiders spin is much finer(B) than the silk that(C) it comes(D) from silkworms.',
    'silk', 'much finer', 'that', 'it comes'],
  [37, 'Needles are simple looking(A) tools, but they(B) are very relatively(C) difficult to make(D).',
    'simple looking', 'they', 'very relatively', 'to make'],
  [38, 'Winslow Homer, who had(A) no formally(B) training in art, became famous for(C) his paintings of the(D) sea and seacoast.',
    'who had', 'formally', 'famous for', 'of the'],
  [39, 'The reflection of sunshines(A) off snow can be so intense(B) that(C) it causes(D) a condition known as "snow blindness."',
    'sunshines', 'so intense', 'that', 'it causes'],
  [40, 'The first(A) rugs were made by the hand(B) and the finest ones(C) are still(D) handmade.',
    'The first', 'by the hand', 'finest ones', 'are still'],
];

// --- Pengganti Reading no. 39 ------------------------------------------------
// Soal asli memakai pilihan berupa gambar diagram, jadi tidak bisa dipakai di
// layar. Penggantinya menguji fakta yang sama dari bacaan guyot ("Their tops are
// not really flat but slope upward to a low pinnacle at the center") dan sengaja
// dibuat berkunci B supaya lembar kunci resmi tetap berlaku.
const READING_39 = {
  number: 39,
  prompt: 'According to the passage, the top of a guyot is best described as',
  a: 'perfectly flat and level from edge to edge',
  b: 'nearly flat but sloping upward to a low pinnacle at the center',
  c: 'sharply pointed, like the cone of an active volcano',
  d: 'deeply cut by offshore canyons on every side',
  key: 'B',
};

(async () => {
  await ensureToeflTables(query);
  const sim = (await query('SELECT id FROM toefl_simulations WHERE title = $1', [TITLE])).rows[0];
  if (!sim) {
    console.error('Simulasi "' + TITLE + '" belum ada. Jalankan seed-toefl-practice2-shell.js dulu.');
    await pool.end();
    process.exit(1);
  }

  const setText = async (section, num, prompt, a, b, c, d) => {
    const r = await query(
      'UPDATE toefl_questions SET prompt = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5'
      + ' WHERE simulation_id = $6 AND section = $7 AND number = $8',
      [prompt, a, b, c, d, sim.id, section, num]
    );
    return r.rowCount;
  };

  let n = 0;
  for (const [num, prompt, a, b, c, d] of STRUCTURE) n += await setText('structure', num, prompt, a, b, c, d);
  for (const [num, prompt, a, b, c, d] of WRITTEN) n += await setText('structure', num, prompt, a, b, c, d);
  console.log('Structure : ' + n + ' dari 40 soal terisi.');

  const r39 = await query(
    'UPDATE toefl_questions SET prompt = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5, correct_option = $6'
    + " WHERE simulation_id = $7 AND section = 'reading' AND number = $8",
    [READING_39.prompt, READING_39.a, READING_39.b, READING_39.c, READING_39.d, READING_39.key, sim.id, READING_39.number]
  );
  console.log('Reading 39: ' + (r39.rowCount ? 'diganti (kunci ' + READING_39.key + ')' : 'TIDAK ditemukan'));

  const sisa = await query(
    'SELECT section, COUNT(*)::int n FROM toefl_questions'
    + " WHERE simulation_id = $1 AND (prompt IS NULL OR prompt = '' OR option_a IS NULL OR option_a = ''"
    + "   OR option_b = '' OR option_c = '' OR option_d = '')"
    + ' GROUP BY section ORDER BY section',
    [sim.id]
  );
  console.log('Masih belum lengkap:', sisa.rows.length ? sisa.rows : 'tidak ada');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
