# ID:CORE Studio

Blackstar ID:CORE Stereo 10 V4 için macOS USB pedal ve ton kontrolü. macOS 12 veya sonrası ve Xcode Command Line Tools gerekir.

## Derle ve çalıştır

```sh
./Scripts/build.sh
open "build/IDCORE Studio.app"
./Scripts/test.sh
```

- `Sources/IDCOREStudio.swift` pencereyi, USB HID iletişimini ve web arayüzü bağlantısını yönetir.
- `Sources/StudioAudio.c` Core Audio akışını, pedal modellerini, akordu ve kayıt tamponunu yönetir.
- `Sources/StudioRecording.swift` WAV dosyalarını seçilen klasöre kayıt sırasında yazar.
- `Sources/StudioSystemAudio.swift` isteğe bağlı Mac sesi kaydını yönetir.
- `Resources/studio-assets` arayüzü, USB komutlarını, pedal kontrollerini ve şarkı presetlerini içerir.

## Kayıt ve USB sesini deneme

1. **Kayıt** sekmesinde hedef klasörü seç. **Sanal gitar** kaydı için **Sanal sesi aç**. Mac’te çalan eşliği almak için **Mac sesi**’ni işaretle. Bu seçenek macOS 14.2 ve sonrası ile sistem sesi kaydı izni gerektirir.
2. **Kaydı başlat** ve çalmayı bitirince **Kaydı durdur**. Dosyalar seçtiğin klasörde yeni bir kayıt klasörüne yazılır. Her seçili kaynak ayrı bir WAV üretir. **Ham gitar ve EQ’yu da kaydet** seçilirse ton karşılaştırma dosyaları ve ayarlar eklenir.
3. Sanal pedal etkisini tek başına duymak için **Doğrudan sesi kıs**. **USB çıkışını dene**, Blackstar’a kısa bir test tonu gönderir. Ton duyulmuyorsa Blackstar’da TAP’ı tutup Volume ile dinleme seviyesini kontrol et. **Pedal Volume** gitar kaydının seviyesinden bağımsızdır.

Blackstar kılavuzunda USB kanal 3, dahili efektlerden ve hoparlör kabini emülasyonundan önceki ön kat olarak tanımlanır. Sanal pedallar bu sinyali işler ve USB 1/2 üzerinden Blackstar hoparlörlerine gönderir. [Blackstar ID:CORE V4 kılavuzu](https://www.blackstaramps.com/wp-content/uploads/2024/01/155300M-VA-1-IDCORE-V4-OWNERS-MANUAL.pdf)

Şarkı tonları yazılımda yeniden oluşturulmuş başlangıç ayarlarıdır. TS9, Germanium OD, Koji Comp ve Memory Man kontrolleri üretici belgelerine dayanır. Riff, manyetik seçimi, amfi ve hoparlör kaydı üzerinden ince ayar yapılabilir. [Ibanez TS9](https://www.ibanez.com/usa/products/detail/ts9_99.html) · [EHX Germanium OD](https://www.ehx.com/wp-content/uploads/2021/01/germanium-od-manual.pdf) · [Suhr Koji Comp](https://www.suhr.com/wp-content/uploads/2016/10/Koji-User-Guide.pdf) · [EHX Memory Man](https://www.ehx.com/wp-content/uploads/2020/11/stereo-memory-man-with-hazarai.pdf)

USB komutları için protokol başvurusu. [ASTRO Blackstar](https://github.com/SirYasko/ASTRO-Blackstar)

## Şarkı ve akort seçimi

Şarkıyı ve varsa bölümünü seçtiğinde sanal pedal zinciri yüklenir. Amfinin donanım yuvaları ayrı çalışır. EQ önerisi bulunan tonlarda **EQ önerisini uygula** düğmesi ayarları Blackstar’a gönderir ve amfiden geri okur.

**Akort ve entonasyon** bölümünde en kalın tel 6, en ince tel 1 olarak gösterilir. Standart akortta açık teller E2–A2–D3–G3–B3–E4, Drop D’de 6. tel D2’dir. **12. perde** modunda önce harmoniği, sonra normal kuvvetle basılan notayı ölç. Pozitif farkta telin titreşen boyu uzatılır, negatif farkta kısaltılır. Her köprü ayarından sonra açık teli yeniden akort et. [Fender entonasyon kılavuzu](https://www.fender.com/articles/maintenance/intonation-101)

**Önerilen amfi Voice**, her şarkı bölümüne göre bir başlangıç ayarı gösterir. Blackstar’ın MANUAL ışığı yanarken **Voice’u uygula** düğmesini kullan veya **Şarkıyla otomatik seç** seçeneğini aç. Uygulama Voice değerini USB’den geri okur. Amfi yuvasını ve EQ’yu kendi kontrollerinden seçebilirsin.

## Clean/Drive seviyesi ve Wah

**Clean ve drive sesini dengele**, ham gitar ile Blackstar’ın ön kat seviyesini karşılaştırıp telafiyi yumuşakça uygular. En fazla +18 dB telafi eder. Son ses **Pedal Volume** ile ayarlanır.

Wah, diğer pedallar gibi zincire eklenir. **Döngü** modunda filtre sürekli hareket eder. **Otomatik** mod pena vuruşuna tepki verir, **Manuel** modda kaydırıcı konumu belirler. Sanal pedalların etkisini tek başına duymak için Blackstar’ın doğrudan Volume’unu kıs.

Blackstar’ın USB ön kat kanalı dahili efektlerden önce gelir. Şarkı tonlarındaki zaman ve modülasyon efektlerini sanal zincir sağlar. [Blackstar kılavuzu](https://blackstaramps.com/wp-content/uploads/2024/01/155300M-VA-1-IDCORE-V4-OWNERS-MANUAL.pdf)
