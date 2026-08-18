# Mimari ve tasarım kararları

Bu dosya "neden böyle" sorularının cevabını tutar. Kurulum için `KURULUM.md`,
günlük kullanım için `README.md`.

## Neden Vercel gibi bir platformda değil

TestKit şirket içinde barındırılır ve bu bir tercih değil, zorunluluk:

- **Agent protokolü kalıcı bir WebSocket sunucusu ister.** Serverless
  platformlar (Vercel, Netlify functions) böyle bir sunucu barındıramaz.
- Bağlı makine listesi, canlı kayıt tamponu ve koşu kuyruğu **process içi
  durumdur**. Bunları izole instance'lara dağıtmak Redis eklemek demektir; bu
  proje tam olarak bundan kaçınıyor.
- SQLite ve `storage/` **kalıcı disk** ister. Serverless dosya sistemi uçucudur;
  yani Postgres artı nesne depolama gerekir.
- En belirleyicisi: koşucunun **test edilecek uygulamaya erişmesi** gerekir. O
  uygulama şirket ağındadır. Public cloud'daki bir fonksiyon ona hiçbir ayarla
  erişemez.
- storageState dosyaları test edilen uygulamanın canlı oturum bilgisini, ekran
  görüntüleri ise verisini taşır. İkisini de ağ içinde tutmak daha savunulabilir.

Yalnızca web arayüzünü dışarıda barındırmak da çözüm değildir: HTTPS bir sayfa
şirket içindeki HTTP sunucuyu mixed content sorunu olmadan çağıramaz ve agent
bağlantısı yine içeride kalmak zorundadır.

Sunucunun test edilecek uygulamaya erişemediği ortaya çıkarsa cevap farklı bir
barındırma modeli değil, mimaride hazır bekleyen `TestRun.target` ve `Runner`
arayüzüdür: koşu, tarayıcının yanına, analist makinesine taşınabilir.

## Kayıt akışı

```
Web arayüzü ──POST /api/recordings──► sunucu ──recording.start──► agent (analist PC)
                                                                    │
                                                          playwright codegen
                                                                    │
                                                             yerel Chromium
                                                                    ▼
                                                             session.jsonl
                                        ◄──recording.action── (aksiyon başına bir ham satır)
                                  sunucu: DSL'e çevirir, temizler, SSE ile yayınlar
Web arayüzü ◄────────── recording.step / recording.stopped ──────────┘
Web arayüzü ──POST /api/recordings/:id/commit──► senaryo + değişkenler
```

Sunucunun ham kayıtla yaptıkları — analistin elle yapmaması için:

- `openPage` / `closePage` atılır, `navigate` korunur
- Aynı alana gelen `fill` yığını son değere indirilir
- Bir sonraki adımın doldurduğu alana yalnızca odaklanan tıklama emilir
- `Tab` tuşu atılır; Enter ve Escape korunur
- Okunabilir hedef yeniden kurulur: `getByRole('button', { name: 'Kaydet' })`
- Her `fill`, `select` ve `upload` için değişken önerilir; ad, alanın erişilebilir
  adından türetilir (`Müşteri Adı` → `musteriAdi`)
- Dosya yükleme adımları zorunlu değişken olarak işaretlenir, çünkü tarayıcı
  yalnızca dosya adını verir

Analist bu listeyi gözden geçirir, sabit kalması gerekenlerin işaretini kaldırır,
gereksiz adımları çıkarır, senaryoya ad verir ve kaydeder.

## Bir değer tarayıcıya nasıl ulaşır

Bir adım, yazacağı değeri saklamaz; bir değişkeni işaret eder. DSL bunu bağ
olarak gösterir:

```
adım  fill  getByRole('textbox', { name: 'Müşteri Adı' })   değer {{customerName}}
                                                            recordedValue "Ahmet"   ← yalnızca bilgi
```

`recordedValue`, analistin kayıt sırasında yazdığı değerdir. Arayüzde gösterilir
ve adım bir değişkene **bağlı değilse** yedek olarak kullanılır; bir veri seti
değerinin yerine asla geçmez. Bu yüzden bağı kaldırmak adımı bozmaz, sabit değere
döndürür; değişkeni yeniden adlandırmak ise hiçbir bağı bozmaz, çünkü adımlar ve
veri seti değerleri değişkenin kimliğine bağlıdır.

Sunucunun uyguladığı tip kuralları, koşucuya anlamsız veri gitmesin diye:

- Yalnızca `fill`, `select` ve `upload` bir değişkene bağlanabilir
- `upload` adımı `file` tipinde değişken ister; `file` değişkenini yalnızca
  `upload` adımı kullanabilir
- Bağlı adım varken değişkeni dosya ile metin arasında çevirmek reddedilir; önce
  bağ kaldırılır

## Veri setleri ve dosyalar

Senaryo testin şeklini, veri seti testin verisini tutar. "Müşteri Oluşturma"
senaryosu bir kez tanımlanır; Ahmet ve Mehmet iki veri setidir:

```
Senaryo: Müşteri Oluşturma
  değişkenler: customerName, customerSurname, document (dosya)

  Veri seti "Ahmet"                    Veri seti "Mehmet"
    customerName    = Ahmet              customerName    = Mehmet
    customerSurname = Yılmaz             customerSurname = Kaya
    document        = ahmet.xlsx         document        = mehmet.xlsx
```

Dosyalar `storage/files/<dosya-id>/<ad>` altında durur; SQLite yalnızca ad, yol,
boyut, tür ve sha256 tutar. Her dosya kendi kimliğiyle adlandırılmış bir klasöre
konur, böylece iki veri setindeki aynı adlı iki dosya birbirinin üzerine yazmaz.

- Bir veri seti silinince yüklenen dosya kayıtta kalır: başka bir set onu
  kullanıyor olabilir ve silinen bir set analistin belgesini götürmemeli.
- Kullanımda olan bir dosya silinemez; hangi setlerde kullanıldığı söylenir.
- Kopyalama, dosyayı çoğaltmaz; aynı dosyaya işaret eder. Bir setteki dosyayı
  değiştirmek yalnızca o setin bağını değiştirir.

### Koşu öncesi kontrol

`GET /api/scenarios/:id/resolve?dataSetId=…` bir koşunun ne yazacağını ve neyi
yükleyeceğini döndürür; eksik varsa `runnable: false` ve tek tek gerekçe verir:

```
"Ahmet" veri setinde "document" için bir dosya yok.
"document" için kayıtlı dosya diskte bulunamadı, yeniden yükleyin.
3. adım bir dosya yüklüyor ama hiçbir dosya değişkenine bağlı değil.
```

Değer çözümleme sırası: veri seti → değişkenin varsayılanı → yok. Bir adımın
`recordedValue` alanı bu sıraya hiç girmez; o yalnızca bilinçli olarak
değişkene bağlanmamış adımlar için geçerlidir. Aynı çözümleyiciyi koşucu da kullanır, böylece ekranda gösterilen ile koşuda kullanılan değer
birbirinden ayrılamaz.

## Oturum profilleri

Bir profil, "oturum açmış olmanın bir yolu"dur; bu proje uygulamanın giriş
biçimini bilmez. Şu anki tek tür `storageState`: Playwright'ın `--save-storage`
ile yazdığı JSON. Analist kayıt tarayıcısında bir kez elle giriş yapar, dosya
sunucuya yüklenir, koşucu `newContext({ storageState })` ile o oturumu kullanır.
SSO ve MFA bu biçime uyar, çünkü girişi insan yapar. İleride betikli giriş veya
token değişimi gerekirse yeni bir `kind` eklenir; koşucu bu servisi aynı şekilde
çağırmaya devam eder.

Dosya canlı oturum bilgisi taşıdığı için `storage/secrets/` altında tutulur ve
HTTP üzerinden asla geri verilmez; API yalnızca "var/yok" ve yakalanma zamanını
söyler.

## Testi çalıştırma

```
Senaryo + Veri seti
        ↓
  VariableResolver            (eksik varsa koşu hiç başlamaz)
        ↓
  RunnerQueue                 (aynı anda tek koşu)
        ↓
  PlaywrightExecutor          (DSL'i doğrudan yorumlar, .spec.ts üretmez)
        ↓
  Chromium (sunucuda, headless)
        ↓
  adım adım PASS/FAIL + her adımın ekran görüntüsü + SSE ile canlı akış
```

Koşu bir kuyruğa alınır ve `202` döner; arayüz sonucu SSE ile canlı izler.
Aynı anda tek koşu çalışır: tarayıcı bu sunucunun en pahalı işi, kuyruğun bir
olması belleği öngörülebilir ve sonuçları tekrarlanabilir kılar. Bu bir sabit,
mimari değil — gerektiğinde artırılır.

- Bir adım başarısız olursa kalanlar `skipped` işaretlenir; test artık
  sandığı sayfada olmadığı için devam etmek yanıltıcı olur.
- **Her adımın** ekran görüntüsü alınır, geçse de kalsa da: bir hatayı okuyan
  analiste bir önceki adımın görüntüsü en az hatanın kendisi kadar gerekir.
- Hata mesajı Playwright'ın uzun çağrı kaydından kısaltılır, ilk satırlar
  okunabilir biçimde saklanır.
- Koşu sırasında **iptal** edilebilir; koşucu adımlar arasında kontrol eder.

### Neden .spec.ts üretilmiyor

Kod üretip sonra reporter çıktısını adım sonuçlarına geri çevirmek iki yönlü bir
çeviri olur. Bu yolda bir adım tek bir çağrı, sonucu tek bir nesne ve ekran
görüntüsü doğal olarak o adıma ait. Bedeli, bekleme ve assertion'ları kendimizin
yazması — ikisinden küçük olan bedel bu.

### Koşu geçmişi bir daha değişmez

`TestRun.resolvedDataJson`, koşunun kullandığı değerlerin o andaki kopyasıdır.
Veri setindeki `Ahmet` sonradan `Ahmet Can` yapılsa bile geçmiş koşu hâlâ
`Ahmet` gösterir; "bu sonuç hangi veriyle alındı" sorusu kesin cevaplanabilir.

### Toplu koşu

Aynı senaryo birden çok veri setiyle tek hamlede çalıştırılabilir; her veri seti
kendi koşu kaydını alır ve kuyrukta sırayla çalışır.

## Playwright sürümü neden tam sabitlenmiş

`apps/agent/package.json` içinde `playwright` sürümü caret olmadan sabitlenmiştir.
Kayıt, `playwright codegen --target=jsonl` üzerinden yapılır; `jsonl` üreteci
`playwright-core` içinde gerçek bir dil üreticisidir ama `codegen --help`
listesinde **görünmez** ve CLI `--target` değerini doğrulamaz, doğrudan
`context._enableRecorder({ language })`'a geçirir. Kolaylık ile belgesizliğin bu
birleşimi, bir duman testi ile tam sürüm sabitlemesini hak ediyor.

Sürümü yükseltmeden önce her zaman:

```bash
npm run smoke:jsonl
```

Bir örnek sayfa açar, sizden onu kullanmanızı ister ve çıkan JSONL'i sunucudaki
çeviricinin beklediği yapıyla karşılaştırır. 1.56.0 üzerinde doğrulananlar:

- İlk satır bir başlık nesnesidir, sonrasında aksiyon başına bir JSON nesnesi
- Alanlar: `name`, `selector`, `signals`, `pageAlias`, `framePath`, `locator`,
  artı aksiyona göre `text` / `options` / `files` / `url`
- `framePath` mevcuttur; iframe desteği ileride yalnızca çeviri işidir
- `setInputFiles` **yalnızca dosya adı** taşır, hiçbir zaman yol taşımaz. Dosya
  yükleme adımının zorunlu bir `file` değişkenine dönüşmesinin nedeni tam olarak
  budur
- `select` ve `setInputFiles` hedefleri, recorder'ın mousedown anında belirlediği
  `_activeModel`'den gelir. Gerçek analist kontrole önce tıkladığı için bu pratikte
  doğrudur; ancak sayfayı Playwright API'siyle gerçek mousedown üretmeden süren bir
  betik yanlış hedef üretir. Duman testinin varsayılan olarak etkileşimli olmasının
  sebebi bu; `--auto` yalnızca boru hattını kontrol eder ve bunu söyler

