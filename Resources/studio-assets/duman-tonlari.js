function songTone(key, title, section, voice, video, hint, chain, eq) {
  return {key, title, section, name: `${title} · ${section}`, voice, video, hint, chain, eq};
}

const songAlbums = [
  {name: 'Eski Köprünün Altında · 1999', tones: [
    songTone('koprualti', 'Köprüaltı', 'Ritim', 'Clean Warm', '2J75v4Y9h7k', 'Hafif, pürüzlü Germanium OD kırılması. Pena vuruşuna yer bırakan kuru zincir.', [[5, 27, 56, 77]]),
    songTone('halimiz-duman', 'Halimiz Duman', 'Ritim', 'Crunch', 'PxioIVfXcpg', 'Pürüzlü Germanium OD ve belirgin, kısa bir yankı.', [[5, 43, 57, 66], [11, 12, 16, 15, 49]]),
    songTone('yalnizlik', 'Yalnızlık Paylaşılmaz', 'Giriş', 'Clean Bright', 'vh1mUa8Q9vc', 'Hafif sürüş ve yavaş Phase 90 süpürmesi.', [[6, 15, 46, 61], [9, 25]])
  ]},
  {name: 'Belki Alışman Lazım · 2002', tones: [
    songTone('bu-aksam', 'Bu Akşam', 'Ritim', 'Crunch', 'bOGTg4msji0', 'Orta sürüşte TS9 ile sıkı, kuru akorlar.', [[6, 43, 44, 69]]),
    songTone('her-seyi-yak', 'Her Şeyi Yak', 'Sahne solosu', 'Crunch', 'JQhVutggvvE', 'Orta frekansları öne alan TS9, belirgin Phase 90 ve az stereo yankı.', [[6, 45, 52, 67], [9, 38], [11, 15, 27, 19, 51]]),
    songTone('oje', 'Oje', 'Ritim', 'Crunch', 'CRm_m-_yElA', 'Kuru ve açık bir crunch için Germanium OD. Akorların ucunu yumuşatan hafif kompresyon.', [[7, 17, 23, 26, 52], [5, 45, 52, 77]]),
    songTone('kirmis-kalbini', 'Kırmış Kalbini', 'Solo', 'Crunch', 'IVklzMRhKiU', 'Pena vuruşunu koruyan kompresyon, koyu TS9 ve tek tük tekrar.', [[7, 33, 30, 44, 57], [6, 38, 42, 66], [11, 19, 33, 23, 45]]),
    songTone('belki-alisman-lazim', 'Belki Alışman Lazım', 'Ritim', 'Clean Bright', 'uWH1T6KLcMk', 'Sıkı bir orta frekans ve az sürüş. Çift seslerin ayrımı için kuru bırakıldı.', [[6, 29, 55, 65]]),
    songTone('bal', 'Bal', 'Temiz ton', 'Clean Warm', 'V0uls6ul1c4', 'Hafif kompresyon ve düşük karışımlı, koyu stereo yankı.', [[7, 24, 18, 45, 54], [11, 13, 29, 21, 42]]),
    songTone('ah', 'Ah', 'Solo', 'Crunch', 'tydOZk0KDRo', 'Yumuşak Germanium OD kırılması ve uzun, düşük seviyeli tekrarlar.', [[7, 26, 25, 47, 55], [5, 39, 55, 82], [11, 20, 37, 25, 43]]),
    songTone('haberin-yok-oluyorum', 'Haberin Yok Ölüyorum', 'Temiz giriş', 'Clean Warm', 'iF-lwUol24g', 'Yavaş Uni-Vibe ve koyu yankıyla arpejler için açık bir alan.', [[7, 24, 24, 45, 54], [10, 22, 26, 0, 57], [11, 18, 34, 24, 40]])
  ]},
  {name: 'Seni Kendime Sakladım · 2005', tones: [
    songTone('yanibasimdan', 'Yanıbaşımdan', 'Temiz ton', 'Clean Warm', '_XzB-gtPno0', 'Yavaş ve sığ Supa-Trem ile az stereo yankı.', [[7, 20, 28, 40, 55], [12, 23, 27, 0, 100], [11, 14, 31, 19, 47]]),
    songTone('yanibasimdan-overdrive', 'Yanıbaşımdan', 'Overdrive / solo', 'Crunch', '_XzB-gtPno0', 'Orta frekansı önde, hafif sıkıştırılmış solo. TS9 Drive %34, Tone %46, Level %59 ve 230 ms düşük karışımlı yankı.', [[7, 22, 27, 37, 53], [6, 34, 46, 59], [11, 12, 25, 18, 41]], {4: 56, 5: 77, 6: 57, 7: 52, 11: 55, 12: 57}),
    songTone('yurekten', 'Yürekten', 'Ritim / crunch', 'Crunch', '0mJqP2xNiPE', 'Düşük gerilimli Germanium OD ile pürüzlü, az sıkışan akorlar. Yankı karışımı düşük, EQ orta frekansları destekler.', [[5, 38, 53, 76], [11, 9, 22, 14, 44]], {4: 57, 5: 73, 6: 64, 7: 55, 11: 60, 12: 62}),
    songTone('seni-kendime-sakladim', 'Seni Kendime Sakladım', 'Solo', 'Crunch', '12oIkuOrkMo', 'Orta sürüşte TS9, dengeli sustain ve kısa stereo tekrar.', [[7, 24, 24, 39, 56], [6, 43, 54, 65], [11, 14, 25, 18, 53]]),
    songTone('en-guzel-gunum-gecem', 'En Güzel Günüm Gecem', 'Ritim', 'Clean Bright', 'RIYTBdJwHjE', 'Açık tonda Germanium OD ve çok hafif, yavaş tremolo.', [[5, 33, 49, 86], [12, 18, 22, 0, 100]]),
    songTone('aman-aman', 'Aman Aman', 'Solo', 'Crunch', '0c8KcSgiBbI', 'Yuvarlak TS9, üstüne koyu ve az tekrarlı delay. Tek notaları öne alır.', [[6, 31, 38, 67], [11, 15, 30, 17, 42]])
  ]},
  {name: 'Duman I · 2009', tones: [
    songTone('dibine-kadar', 'Dibine Kadar', 'Solo', 'Super Crunch', 'vk1P7qpSxUE', 'Daha güçlü TS9 sürüşü ve altta kısa bir stereo yankı.', [[7, 25, 20, 35, 55], [6, 51, 56, 67], [11, 15, 27, 20, 52]]),
    songTone('sor-bana', 'Sor Bana Pişman Mıyım?', 'Solo', 'Crunch', 'yzRIhUjAO28', 'Koyu TS9 ve nota sonlarını dolduran orta uzunlukta delay.', [[6, 36, 39, 64], [11, 22, 35, 26, 45]]),
    songTone('sevdim-desem', 'Sevdim Desem', 'Temiz ton', 'Clean Warm', '9FxMNycXe_A', 'Hafif Koji Comp, sığ Uni-Vibe ve kısa yankı.', [[7, 26, 25, 43, 54], [10, 27, 30, 0, 57], [11, 13, 25, 17, 49]]),
    songTone('helal-olsun', 'Helal Olsun', 'Solo', 'Clean Bright', 'yQ9B65Z4wi4', 'Germanium OD üzerinde hafif TS9 yükseltmesi ve kısa, koyu tekrar.', [[5, 27, 51, 82], [6, 18, 47, 71], [11, 15, 28, 20, 43]])
  ]},
  {name: 'Duman II · 2009', tones: [
    songTone('balik', 'Balık', 'Solo', 'Clean Bright', 'a2WCr5-w0TQ', 'Atak bir Germanium OD ve akıcı orta frekans için düşük sürüşte TS9.', [[5, 35, 58, 76], [6, 17, 48, 66]]),
    songTone('senden-daha-guzel', 'Senden Daha Güzel', 'Solo', 'Crunch', 'MDWUyOcmN3c', 'Paralel kompresyon, orta sürüşte TS9 ve kısa, düşük seviyeli tekrar.', [[7, 28, 18, 38, 53], [6, 33, 56, 65], [11, 17, 25, 17, 58]]),
    songTone('elleri-ellerime', 'Elleri Ellerime', 'Solo', 'Crunch', 'jFwc0Vez2ck', 'Yuvarlak sürüş ve geride duran stereo tekrar. Soloda pena vuruşunu korur.', [[7, 21, 26, 35, 55], [6, 32, 40, 68], [11, 19, 32, 25, 46]])
  ]},
  {name: 'Darmaduman · 2013', tones: [
    songTone('yurek', 'Yürek', 'Ritim', 'Crunch', 'Pp_-OoAAzFE', 'Orta sürüşte TS9 ve kuru, belirgin akor vuruşları.', [[6, 40, 50, 67]]),
    songTone('akibet', 'Akıbet', 'Ritim', 'Crunch', 'g7q5ZsT4iSo', 'Daha düşük pil gerilimiyle pürüzlenen Germanium OD ve hafif sıkıştırma.', [[7, 23, 21, 35, 55], [5, 49, 58, 63]]),
    songTone('oyle-dertli-ritim', 'Öyle Dertli', 'Ritim / nakarat', 'Crunch', '1xTYWFvMQ0o', 'Geniş akorlar için koyu Germanium OD ve düşük karışımlı kısa yankı.', [[5, 32, 54, 84], [11, 10, 23, 16, 40]], {4: 63, 5: 70, 6: 53, 7: 60, 11: 64, 12: 50}),
    songTone('oyle-dertli', 'Öyle Dertli', 'Solo', 'Crunch', '1xTYWFvMQ0o', 'Yuvarlak Germanium OD kırılması, 472 ms stereo tekrar ve düşük geçiren filtre.', [[7, 31, 24, 42, 55], [5, 45, 52, 82], [11, 22, 38, 24, 36]], {4: 57, 5: 78, 6: 52, 7: 58, 11: 58, 12: 53})
  ]},
  {name: 'Kufi · 2024', tones: [
    songTone('nerde-benim-kafam', 'Nerde Benim Kafam', 'Riff', 'Super Crunch', 'MMzOWe0F2J0', 'Daha parlak TS9 ile kısa, keskin vuruşlara yer bırakan kuru bir riff tonu.', [[6, 49, 59, 65]]),
    songTone('kufi', 'Kufi', 'Riff', 'Crunch', 'Wu2iGQNk1rI', 'Belirgin Germanium kırılması ve düşük TS9 sürüşüyle sıkılaştırılmış baslar.', [[5, 43, 58, 73], [6, 19, 48, 65]]),
    songTone('bir-guzellik-yapsana', 'Bir Güzellik Yapsana', 'Temiz ton', 'Clean Bright', '9xRCv0ZAgys', 'Koji Comp ve sığ Uni-Vibe. Akorların arkasında hafif stereo tekrar.', [[7, 21, 24, 45, 55], [10, 28, 27, 0, 58], [11, 12, 30, 19, 50]]),
    songTone('canimsin', 'Canımsın', 'Temiz ton', 'Clean Warm', 'qD4MS8HR7XM', 'Yumuşak, yavaş Supa-Trem ve karanlık yankıyla sakin arpejler.', [[7, 26, 25, 40, 55], [12, 24, 27, 0, 100], [11, 15, 36, 22, 41]]),
    songTone('farkimiz-yok', 'Farkımız Yok', 'Ritim', 'Clean Bright', 'ONTp1W_nW6c', 'Düşük karışımlı modülasyon ve kontrollü TS9 kırılması.', [[6, 32, 47, 67], [10, 19, 19, 0, 55]])
  ]}
];
