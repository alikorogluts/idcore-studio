// Track order and recording IDs follow the seven studio album pages on dumanlive.com.
// These are playable Blackstar/Strat starting points. Published recordings are listening references.
const toneProfiles = {
  clean:    {voice: 'Clean Bright', pickup: 4, eq: [65, 60, 62, 49, 57, 52], chain: [[7, 23, 22, 42, 54]], hint: 'Açık akorlar için hafif kompresyon ve belirgin pena atağı.'},
  warm:     {voice: 'Clean Warm', pickup: 4, eq: [64, 66, 55, 52, 58, 49], chain: [[7, 22, 25, 39, 55], [11, 13, 27, 18, 44]], hint: 'Yumuşak arpejler için hafif kompresyon ve koyu, kısa tekrar.'},
  clear:    {voice: 'Clean Bright', pickup: 3, eq: [60, 59, 63, 48, 55, 54], chain: [[7, 18, 29, 32, 55], [11, 10, 23, 15, 50]], hint: 'Tek tek notaları belirgin tutan açık ton ve geride kısa tekrar.'},
  funk:     {voice: 'Clean Bright', pickup: 2, eq: [58, 62, 62, 50, 52, 53], chain: [[7, 22, 22, 43, 56], [5, 15, 49, 88]], hint: 'Kesik akorlar için köprü ve orta karışımıyla hafif kırılma.'},
  crunch:   {voice: 'Crunch', pickup: 2, eq: [59, 72, 58, 55, 59, 55], chain: [[5, 34, 53, 79]], hint: 'Akorların ayrımını koruyan orta sürüş ve hafif Germanium kırılması.'},
  tight:    {voice: 'Super Crunch', pickup: 1, eq: [55, 73, 58, 53, 57, 54], chain: [[6, 27, 44, 63]], hint: 'Sıkı riffler için TS9 basları toplar. Pena vuruşu önde kalır.'},
  lead:     {voice: 'Crunch', pickup: 1, eq: [57, 77, 55, 54, 57, 54], chain: [[6, 38, 46, 66], [11, 16, 30, 20, 47]], hint: 'Tek notaları öne alan orta frekans, kontrollü sürüş ve kısa tekrar.'},
  warmLead: {voice: 'Crunch', pickup: 5, eq: [55, 75, 59, 54, 56, 55], chain: [[7, 23, 23, 36, 54], [6, 33, 50, 64], [11, 16, 31, 20, 45]], hint: 'Sap manyetiği, yuvarlak atak ve uzun notalar için hafif kompresyon.'}
};
const stratPickups = ['Köprü', 'Köprü + orta', 'Orta', 'Orta + sap', 'Sap'];
const toneEQParameters = [4, 5, 6, 7, 11, 12];

function songTone(key, title, section, video, profileName, overrides = {}) {
  const profile = toneProfiles[profileName];
  const {voice = profile.voice, pickup = profile.pickup, hint = profile.hint, chain = profile.chain,
    eq = Object.fromEntries(toneEQParameters.map((parameter, index) => [parameter, profile.eq[index]]))} = overrides;
  return {key, title, section, name: `${title} · ${section}`, video, voice, pickup, hint, chain, eq};
}

function stratEQ(tone, guitarType) {
  if (guitarType !== 'hss' || tone.pickup !== 1) return tone.eq;
  // A full bridge humbucker can add low mids. Keep the adjustment small and leave gain to the player.
  return {...tone.eq, 4: Math.max(0, tone.eq[4] - 5), 5: Math.max(0, tone.eq[5] - 3), 6: Math.min(127, tone.eq[6] + 3)};
}

const songAlbums = [
  {name: "Eski Köprünün Altında · 1999", tones: [
    songTone("koprualti", "Köprüaltı", "Ritim", "2J75v4Y9h7k", "crunch", {voice: "Clean Warm", hint: "Hafif, pürüzlü Germanium OD kırılması. Pena vuruşuna yer bırakan kuru zincir.", chain: [[5, 27, 56, 77]]}),
    songTone("koprualti-solo", "Köprüaltı", "Solo", "2J75v4Y9h7k", "warmLead"),
    songTone("bebek", "Bebek", "Temiz ton", "rZyPWRg7g3I", "clean"),
    songTone("hatun", "Hatun", "Ritim", "7P6suoOUrqc", "crunch"),
    songTone("hatun-solo", "Hatun", "Solo", "7P6suoOUrqc", "warmLead"),
    songTone("halimiz-duman", "Halimiz Duman", "Ritim", "PxioIVfXcpg", "crunch", {pickup: 1, hint: "Pürüzlü Germanium OD ve belirgin, kısa bir yankı.", chain: [[5, 43, 57, 66], [11, 12, 16, 15, 49]]}),
    songTone("halimiz-duman-solo", "Halimiz Duman", "Solo", "PxioIVfXcpg", "lead"),
    songTone("daglar-baglar", "Dağlar Bağlar", "Arpej / temiz ton", "Ihl_B_PfSTA", "clear"),
    songTone("hayati-yasa", "Hayatı Yaşa", "Ritim", "XIdbDhrowvU", "crunch"),
    songTone("hayati-yasa-solo", "Hayatı Yaşa", "Solo", "XIdbDhrowvU", "lead"),
    songTone("yalnizlik", "Yalnızlık Paylaşılmaz", "Giriş", "vh1mUa8Q9vc", "clean", {hint: "Hafif sürüş ve yavaş Phase 90 süpürmesi.", chain: [[6, 15, 46, 61], [9, 25]]}),
    songTone("donek", "Dönek", "Riff / ritim", "Fv8D675obRU", "tight"),
    songTone("istanbul", "İstanbul", "Temiz ton", "N01nEpLUNn8", "clean"),
    songTone("senin-gibi", "Senin Gibi", "Temiz giriş", "ZdIpEuJl81g", "warm")
  ]},
  {name: "Belki Alışman Lazım · 2002", tones: [
    songTone("bu-aksam", "Bu Akşam", "Ritim", "bOGTg4msji0", "tight", {voice: "Crunch", hint: "Orta sürüşte TS9 ile sıkı, kuru akorlar.", chain: [[6, 43, 44, 69]]}),
    songTone("bu-aksam-solo", "Bu Akşam", "Solo", "bOGTg4msji0", "lead"),
    songTone("her-seyi-yak-giris", "Her Şeyi Yak", "Giriş", "JQhVutggvvE", "warm"),
    songTone("her-seyi-yak-ritim-nakarat", "Her Şeyi Yak", "Ritim / nakarat", "JQhVutggvvE", "crunch"),
    songTone("her-seyi-yak", "Her Şeyi Yak", "Solo", "JQhVutggvvE", "lead", {hint: "Orta frekansları öne alan TS9, belirgin Phase 90 ve az stereo yankı.", chain: [[6, 45, 52, 67], [9, 38], [11, 15, 27, 19, 51]]}),
    songTone("oje", "Oje", "Ritim", "CRm_m-_yElA", "crunch", {hint: "Kuru ve açık bir crunch için Germanium OD. Akorların ucunu yumuşatan hafif kompresyon.", chain: [[7, 17, 23, 26, 52], [5, 45, 52, 77]]}),
    songTone("oje-solo", "Oje", "Solo", "CRm_m-_yElA", "lead"),
    songTone("kirmis-kalbini-ritim", "Kırmış Kalbini", "Ritim", "IVklzMRhKiU", "warm"),
    songTone("kirmis-kalbini", "Kırmış Kalbini", "Solo", "IVklzMRhKiU", "warmLead", {hint: "Pena vuruşunu koruyan kompresyon, koyu TS9 ve tek tük tekrar.", chain: [[7, 33, 30, 44, 57], [6, 38, 42, 66], [11, 19, 33, 23, 45]]}),
    songTone("masal", "Masal", "Arpej / temiz ton", "gA8ecRcXnSs", "clear"),
    songTone("manasi-yok", "Manası Yok", "Riff / ritim", "u6qNscd8yEM", "tight"),
    songTone("belki-alisman-lazim", "Belki Alışman Lazım", "Ritim", "uWH1T6KLcMk", "crunch", {voice: "Clean Bright", hint: "Sıkı bir orta frekans ve az sürüş. Çift seslerin ayrımı için kuru bırakıldı.", chain: [[6, 29, 55, 65]]}),
    songTone("belki-alisman-lazim-solo", "Belki Alışman Lazım", "Solo", "uWH1T6KLcMk", "lead"),
    songTone("bal", "Bal", "Temiz ton", "V0uls6ul1c4", "warm", {pickup: 5, hint: "Hafif kompresyon ve düşük karışımlı, koyu stereo yankı.", chain: [[7, 24, 18, 45, 54], [11, 13, 29, 21, 42]]}),
    songTone("bal-solo", "Bal", "Solo", "V0uls6ul1c4", "warmLead"),
    songTone("ah-giris-arpej", "Ah", "Giriş / arpej", "tydOZk0KDRo", "warm"),
    songTone("ah", "Ah", "Solo", "tydOZk0KDRo", "warmLead", {hint: "Yumuşak Germanium OD kırılması ve uzun, düşük seviyeli tekrarlar.", chain: [[7, 26, 25, 47, 55], [5, 39, 55, 82], [11, 20, 37, 25, 43]]}),
    songTone("elimdeki-saz-yeter-canima", "Elimdeki Saz Yeter Canıma", "Arpej / temiz ton", "YvJyKKfKOgo", "clear"),
    songTone("haberin-yok-oluyorum", "Haberin Yok Ölüyorum", "Temiz giriş", "iF-lwUol24g", "warm", {hint: "Yavaş Uni-Vibe ve koyu yankıyla arpejler için açık bir alan.", chain: [[7, 24, 24, 45, 54], [10, 22, 26, 0, 57], [11, 18, 34, 24, 40]]}),
    songTone("haberin-yok-oluyorum-yukselen-bolum", "Haberin Yok Ölüyorum", "Yükselen bölüm", "iF-lwUol24g", "warmLead"),
    songTone("bu-aksam-akustik", "Bu Akşam · Akustik", "Arpej / temiz ton", "GLWVB37iVVM", "clear"),
    songTone("kirmis-kalbini-uzun-versiyon", "Kırmış Kalbini · Uzun Versiyon", "Ritim", "g7-RXUNDqVI", "crunch")
  ]},
  {name: "Seni Kendime Sakladım · 2005", tones: [
    songTone("ozgurlugun-ulkesi", "Özgürlüğün Ülkesi", "Riff / ritim", "I37issyIRww", "tight"),
    songTone("sayin-bayan", "Sayın Bayan", "Ritim", "ERa6c1QAdOA", "funk"),
    songTone("sayin-bayan-solo", "Sayın Bayan", "Solo", "ERa6c1QAdOA", "lead"),
    songTone("yanibasimdan", "Yanıbaşımdan", "Temiz ton", "_XzB-gtPno0", "warm", {hint: "Yavaş ve sığ Supa-Trem ile az stereo yankı.", chain: [[7, 20, 28, 40, 55], [12, 23, 27, 0, 100], [11, 14, 31, 19, 47]]}),
    songTone("yanibasimdan-overdrive", "Yanıbaşımdan", "Overdrive / solo", "_XzB-gtPno0", "lead", {hint: "Orta frekansı önde, hafif sıkıştırılmış solo. TS9 Drive %34, Tone %46, Level %59 ve 230 ms düşük karışımlı yankı.", chain: [[7, 22, 27, 37, 53], [6, 34, 46, 59], [11, 12, 25, 18, 41]], eq: {4: 56, 5: 77, 6: 57, 7: 52, 11: 55, 12: 57}}),
    songTone("seni-kendime-sakladim-giris-ritim", "Seni Kendime Sakladım", "Giriş / ritim", "12oIkuOrkMo", "crunch"),
    songTone("seni-kendime-sakladim", "Seni Kendime Sakladım", "Solo", "12oIkuOrkMo", "lead", {hint: "Orta sürüşte TS9, dengeli sustain ve kısa stereo tekrar.", chain: [[7, 24, 24, 39, 56], [6, 43, 54, 65], [11, 14, 25, 18, 53]]}),
    songTone("sen-ben", "Sen Ben", "Ritim", "KrneJzumy6A", "crunch"),
    songTone("melek", "Melek", "Temiz giriş", "6ku1ek4cYZY", "warm"),
    songTone("melek-yukselen-bolum", "Melek", "Yükselen bölüm", "6ku1ek4cYZY", "warmLead"),
    songTone("en-guzel-gunum-gecem", "En Güzel Günüm Gecem", "Ritim", "RIYTBdJwHjE", "clean", {pickup: 2, hint: "Açık tonda Germanium OD ve çok hafif, yavaş tremolo.", chain: [[5, 33, 49, 86], [12, 18, 22, 0, 100]]}),
    songTone("en-guzel-gunum-gecem-solo", "En Güzel Günüm Gecem", "Solo", "RIYTBdJwHjE", "warmLead"),
    songTone("yurekten", "Yürekten", "Ritim / crunch", "0mJqP2xNiPE", "crunch", {hint: "Düşük gerilimli Germanium OD ile pürüzlü, az sıkışan akorlar. Yankı karışımı düşük, EQ orta frekansları destekler.", chain: [[5, 38, 53, 76], [11, 9, 22, 14, 44]], eq: {4: 57, 5: 73, 6: 64, 7: 55, 11: 60, 12: 62}}),
    songTone("yurekten-solo", "Yürekten", "Solo", "0mJqP2xNiPE", "lead"),
    songTone("aman-aman-giris-ritim", "Aman Aman", "Giriş / ritim", "0c8KcSgiBbI", "warm"),
    songTone("aman-aman", "Aman Aman", "Solo", "0c8KcSgiBbI", "warmLead", {hint: "Yuvarlak TS9, üstüne koyu ve az tekrarlı delay. Tek notaları öne alır.", chain: [[6, 31, 38, 67], [11, 15, 30, 17, 42]]}),
    songTone("sadece-koklayacaktim", "Sadece Koklayacaktım", "Temiz giriş", "msRhz5whZfk", "warm"),
    songTone("ruyanda-gorsen-inanma", "Rüyanda Görsen İnanma", "Arpej / temiz ton", "8F_oSXnp59E", "clear"),
    songTone("gecmis-olsun", "Geçmiş Olsun", "Solo / lead", "Xcs_ccasdek", "lead")
  ]},
  {name: "Duman I · 2009", tones: [
    songTone("dibine-kadar-riff-ritim", "Dibine Kadar", "Riff / ritim", "vk1P7qpSxUE", "tight"),
    songTone("dibine-kadar", "Dibine Kadar", "Solo", "vk1P7qpSxUE", "lead", {voice: "Super Crunch", hint: "Daha güçlü TS9 sürüşü ve altta kısa bir stereo yankı.", chain: [[7, 25, 20, 35, 55], [6, 51, 56, 67], [11, 15, 27, 20, 52]]}),
    songTone("sarhos", "Sarhoş", "Ritim", "hT7vYxkQz8g", "crunch"),
    songTone("sor-bana-giris-ritim", "Sor Bana Pişman Mıyım?", "Giriş / ritim", "yzRIhUjAO28", "crunch"),
    songTone("sor-bana", "Sor Bana Pişman Mıyım?", "Solo", "yzRIhUjAO28", "warmLead", {hint: "Koyu TS9 ve nota sonlarını dolduran orta uzunlukta delay.", chain: [[6, 36, 39, 64], [11, 22, 35, 26, 45]]}),
    songTone("hayvan", "Hayvan", "Riff / ritim", "YUi9v55PMtI", "tight"),
    songTone("yalan", "Yalan", "Temiz giriş", "xZ2NjB_9tsk", "warm"),
    songTone("sevdim-desem", "Sevdim Desem", "Temiz ton", "9FxMNycXe_A", "warm", {hint: "Hafif Koji Comp, sığ Uni-Vibe ve kısa yankı.", chain: [[7, 26, 25, 43, 54], [10, 27, 30, 0, 57], [11, 13, 25, 17, 49]]}),
    songTone("sevdim-desem-solo", "Sevdim Desem", "Solo", "9FxMNycXe_A", "warmLead"),
    songTone("yagmurun-sabahinda", "Yağmurun Sabahında", "Arpej / temiz ton", "zLAnPYC1gws", "clear"),
    songTone("helal-olsun", "Helal Olsun", "Solo", "yQ9B65Z4wi4", "lead", {voice: "Clean Bright", hint: "Germanium OD üzerinde hafif TS9 yükseltmesi ve kısa, koyu tekrar.", chain: [[5, 27, 51, 82], [6, 18, 47, 71], [11, 15, 28, 20, 43]]}),
    songTone("rezil", "Rezil", "Riff / ritim", "NvM1xjAQeNg", "tight"),
    songTone("bu-ask-beni-yorar", "Bu Aşk Beni Yorar", "Temiz giriş", "KA_mAq-dMY0", "warm")
  ]},
  {name: "Duman II · 2009", tones: [
    songTone("balik-riff-ritim", "Balık", "Riff / ritim", "a2WCr5-w0TQ", "crunch"),
    songTone("balik", "Balık", "Solo", "a2WCr5-w0TQ", "lead", {voice: "Clean Bright", hint: "Atak bir Germanium OD ve akıcı orta frekans için düşük sürüşte TS9.", chain: [[5, 35, 58, 76], [6, 17, 48, 66]]}),
    songTone("senin-marsin", "Senin Marşın", "Riff / ritim", "E9YS_jP64aw", "tight"),
    songTone("senden-daha-guzel-giris-ritim", "Senden Daha Güzel", "Giriş / ritim", "MDWUyOcmN3c", "crunch"),
    songTone("senden-daha-guzel", "Senden Daha Güzel", "Solo", "MDWUyOcmN3c", "lead", {hint: "Paralel kompresyon, orta sürüşte TS9 ve kısa, düşük seviyeli tekrar.", chain: [[7, 28, 18, 38, 53], [6, 33, 56, 65], [11, 17, 25, 17, 58]]}),
    songTone("iyi-de-bana-ne", "İyi De Bana Ne", "Riff / ritim", "3CUxkQx39CM", "tight"),
    songTone("elleri-ellerime-giris-ritim", "Elleri Ellerime", "Giriş / ritim", "jFwc0Vez2ck", "warm"),
    songTone("elleri-ellerime", "Elleri Ellerime", "Solo", "jFwc0Vez2ck", "warmLead", {hint: "Yuvarlak sürüş ve geride duran stereo tekrar. Soloda pena vuruşunu korur.", chain: [[7, 21, 26, 35, 55], [6, 32, 40, 68], [11, 19, 32, 25, 46]]}),
    songTone("paranoya", "Paranoya", "Riff / ritim", "Pzy8sMb4-34", "tight"),
    songTone("vals", "Vals", "Arpej / temiz ton", "kpQYd9i5Npg", "clear"),
    songTone("kumbela", "Kümbela", "Ritim", "EKEVeP0Z7q4", "crunch"),
    songTone("tovbe", "Tövbe", "Temiz giriş", "JyNos0476Hs", "warm"),
    songTone("of", "Of", "Temiz giriş", "VNRvcxFb7YU", "warm")
  ]},
  {name: "Darmaduman · 2013", tones: [
    songTone("seviyorsan-inaniyorsan", "Seviyorsan İnanıyorsan", "Ritim", "2Weryult89Q", "crunch"),
    songTone("eyvallah", "Eyvallah", "Riff / ritim", "8Cc5yyK4g-I", "tight"),
    songTone("eyvallah-solo", "Eyvallah", "Solo", "8Cc5yyK4g-I", "lead"),
    songTone("deli", "Deli", "Riff / ritim", "KdfFeGmaZvI", "tight"),
    songTone("yurek", "Yürek", "Ritim", "Pp_-OoAAzFE", "crunch", {hint: "Orta sürüşte TS9 ve kuru, belirgin akor vuruşları.", chain: [[6, 40, 50, 67]]}),
    songTone("yurek-solo", "Yürek", "Solo", "Pp_-OoAAzFE", "warmLead"),
    songTone("kopekler", "Köpekler", "Riff / ritim", "_W8mIj2yotA", "tight"),
    songTone("akibet", "Akıbet", "Ritim", "g7q5ZsT4iSo", "crunch", {pickup: 1, hint: "Daha düşük pil gerilimiyle pürüzlenen Germanium OD ve hafif sıkıştırma.", chain: [[7, 23, 21, 35, 55], [5, 49, 58, 63]]}),
    songTone("akibet-solo", "Akıbet", "Solo", "g7q5ZsT4iSo", "lead"),
    songTone("saldir", "Saldır", "Riff / ritim", "CI2IonmTynM", "tight"),
    songTone("kolay-degildir", "Kolay Değildir", "Temiz giriş", "Q4Kk5pZZcf4", "warm"),
    songTone("kolay-degildir-yukselen-bolum", "Kolay Değildir", "Yükselen bölüm", "Q4Kk5pZZcf4", "warmLead"),
    songTone("gonul-ister", "Gönül İster", "Temiz giriş", "Kqy7Fd5gsK4", "warm"),
    songTone("gozleri-kanli", "Gözleri Kanlı", "Temiz giriş", "oIvhaOGNDEk", "warm"),
    songTone("oyle-dertli-ritim", "Öyle Dertli", "Ritim / nakarat", "1xTYWFvMQ0o", "crunch", {hint: "Geniş akorlar için koyu Germanium OD ve düşük karışımlı kısa yankı.", chain: [[5, 32, 54, 84], [11, 10, 23, 16, 40]], eq: {4: 63, 5: 70, 6: 53, 7: 60, 11: 64, 12: 50}}),
    songTone("oyle-dertli", "Öyle Dertli", "Solo", "1xTYWFvMQ0o", "warmLead", {hint: "Yuvarlak Germanium OD kırılması, 472 ms stereo tekrar ve düşük geçiren filtre.", chain: [[7, 31, 24, 42, 55], [5, 45, 52, 82], [11, 22, 38, 24, 36]], eq: {4: 57, 5: 78, 6: 52, 7: 58, 11: 58, 12: 53}}),
    songTone("melankoli", "Melankoli", "Temiz ton", "ZNe-DAxj7dU", "clean"),
    songTone("sinana-sinana", "Sınana Sınana", "Solo / lead", "ff-p0AyiowM", "lead")
  ]},
  {name: "Kufi · 2024", tones: [
    songTone("nerde-benim-kafam", "Nerde Benim Kafam", "Riff", "MMzOWe0F2J0", "tight", {hint: "Daha parlak TS9 ile kısa, keskin vuruşlara yer bırakan kuru bir riff tonu.", chain: [[6, 49, 59, 65]]}),
    songTone("nerde-benim-kafam-solo-lead", "Nerde Benim Kafam", "Solo / lead", "MMzOWe0F2J0", "lead"),
    songTone("kufi", "Kufi", "Riff", "Wu2iGQNk1rI", "tight", {voice: "Crunch", hint: "Belirgin Germanium kırılması ve düşük TS9 sürüşüyle sıkılaştırılmış baslar.", chain: [[5, 43, 58, 73], [6, 19, 48, 65]]}),
    songTone("kufi-solo-lead", "Kufi", "Solo / lead", "Wu2iGQNk1rI", "lead"),
    songTone("icimde-ask-var", "İçimde Aşk Var", "Ritim", "o_l2fwccdGo", "crunch"),
    songTone("bir-guzellik-yapsana", "Bir Güzellik Yapsana", "Temiz ton", "9xRCv0ZAgys", "clean", {hint: "Koji Comp ve sığ Uni-Vibe. Akorların arkasında hafif stereo tekrar.", chain: [[7, 21, 24, 45, 55], [10, 28, 27, 0, 58], [11, 12, 30, 19, 50]]}),
    songTone("bir-guzellik-yapsana-yukselen-bolum", "Bir Güzellik Yapsana", "Yükselen bölüm", "9xRCv0ZAgys", "warmLead"),
    songTone("haykirdim-ben", "Haykırdım Ben", "Riff / ritim", "tNKTJz_jrGs", "tight"),
    songTone("kamikaze", "Kamikaze", "Riff / ritim", "cfQ-bIc4NFU", "tight"),
    songTone("gazze-de", "Gazze'de", "Temiz giriş", "4xjVpG4sZ9E", "warm"),
    songTone("canimsin", "Canımsın", "Temiz ton", "qD4MS8HR7XM", "warm", {pickup: 5, hint: "Yumuşak, yavaş Supa-Trem ve karanlık yankıyla sakin arpejler.", chain: [[7, 26, 25, 40, 55], [12, 24, 27, 0, 100], [11, 15, 36, 22, 41]]}),
    songTone("canimsin-solo", "Canımsın", "Solo", "qD4MS8HR7XM", "warmLead"),
    songTone("hele-hele-gur-gur", "Hele Hele Gur Gur", "Ritim", "qAA1G21AIbs", "funk"),
    songTone("teessuf-ederim", "Teessüf Ederim", "Arpej / temiz ton", "zj0hYBMpM2w", "clear"),
    songTone("icimde-bir-bahar", "İçimde Bir Bahar", "Temiz ton", "Y38-gv3hmpo", "clean"),
    songTone("anilar-o-geceler", "Anılar, O Geceler", "Temiz giriş", "mbHr3SJpt3w", "warm"),
    songTone("farkimiz-yok", "Farkımız Yok", "Ritim", "ONTp1W_nW6c", "crunch", {voice: "Clean Bright", hint: "Düşük karışımlı modülasyon ve kontrollü TS9 kırılması.", chain: [[6, 32, 47, 67], [10, 19, 19, 0, 55]]}),
    songTone("farkimiz-yok-solo", "Farkımız Yok", "Solo", "ONTp1W_nW6c", "lead"),
    songTone("ben-senden-vazgecmem", "Ben Senden Vazgeçmem", "Temiz giriş", "-N4sU3SEDU8", "warm"),
    songTone("masallah", "Maşallah", "Riff / ritim", "_uo5xTf8UjA", "tight"),
    songTone("zelzele", "Zelzele", "Riff / ritim", "J1m1Gk-P2Ps", "tight")
  ]}
];
