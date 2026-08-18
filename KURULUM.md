# TestKit — Kurulum

MVP tamamlandı: **kayıt alma, senaryo yönetimi, veri setleri ve testi
çalıştırma** — hepsi çalışıyor. Kurulumu yapıp gerçek uygulamanla baştan sona
kullanabilirsin.

---

## Önce bunlar hazır olsun

| Ne | Nerede | Not |
| --- | --- | --- |
| Node.js **20 LTS veya 22 LTS** | Sunucu makinesi **ve** her analist bilgisayarı | https://nodejs.org → "LTS". Node 16 ve altı **çalışmaz**: Prisma 18.18+, Playwright ve Vite 18+ istiyor ve Node 16 destek dışı. |
| İnternet erişimi | Kurulum sırasında | `npm install` ve Chromium indirmesi için. Sonrasında gerekmez. |
| Bir makine | Şirket içi, sürekli açık | Küçük bir VM veya bir masaüstü yeter. **Test edilecek uygulamaya erişebilmesi gerekir** — koşular burada çalışır. |

`testkit.zip` dosyasını indirip aç. İçindeki `testkit` klasörü tüm projedir.

---

## 1. Sunucu (bir kez, 10 dakika)

`testkit` klasörünü sunucu makinesine kopyala. Sonra klasörün içindeki
**`TestKit Server Baslat.cmd`** dosyasına çift tıkla.

Bu dosya sırayla şunları yapar:

1. Node.js'i kontrol eder
2. `npm install` çalıştırır (ilk seferde 1–2 dakika)
3. `.env` dosyasını `.env.example`'dan oluşturur
4. Veritabanını hazırlar (`prisma migrate deploy`)
5. Koşular için Chromium'u indirir (`npx playwright install chromium`, bir kez)
6. Arayüzü derler ve **her şeyi tek portta (3001)** yayınlar
7. Analistlere vereceğin adresi ekrana yazar, örneğin `http://192.168.1.40:3001`

Pencere açık kalmalı; kapatırsan TestKit herkes için durur.

Elle yapmayı tercih edersen:

```
npm install
copy .env.example .env
npx prisma migrate deploy
npx playwright install chromium
npm start
```

> **Önemli:** Chromium'u sunucuda da kurman gerekiyor, çünkü testler orada
> koşuyor. `TestKit Server Baslat.cmd` bunu kendisi yapar.

**Kontrol:** tarayıcıdan `http://localhost:3001` → Sunucu panelinde
`api / veritabanı / dosya klasörü` üçünün de yeşil (`çalışıyor`, `ok`) olması
gerekir.

**Güvenlik duvarı:** 3001 portunun şirket içi ağdan erişilebilir, dışarıdan
kapalı olması gerekir. Analistler bu porta erişemezse sayfa açılmaz.

**Otomatik başlatma:** Görev Zamanlayıcı'da "Bilgisayar başlatıldığında"
tetikleyicisiyle `TestKit Server Baslat.cmd` dosyasını göster.

---

## 2. Analist bilgisayarı (makine başına bir kez)

Bu adımı **sen** yapıyorsun, analist hiçbir şey yazmıyor.

1. Tarayıcıdan sunucu adresini aç → **Makineler ve sunucu** sekmesi
2. Makine adını yaz (örneğin `AHMET-PC`) → **Makineyi kaydet**
3. Listede o satırda **Config indir** düğmesine bas →
   `testkit-agent.config.json` dosyası iner
4. `testkit` klasörünün bir kopyasını o bilgisayara at
5. İndirdiğin `testkit-agent.config.json` dosyasını
   `testkit\apps\agent\` klasörünün içine koy

> Agent şimdilik projenin tamamıyla birlikte çalışır, bu yüzden analist
> bilgisayarına klasörün bir kopyası gider. Tek dosya hâline getirmek için
> Windows üzerinde `npm run build:exe -w @testkit/agent` komutu kullanılabilir.

---

## 3. Analistin yapacağı (her gün, tek hareket)

`testkit\apps\agent\` içindeki **`TestKit Agent Baslat.cmd`** dosyasına çift
tıklar ve pencereyi açık bırakır.

İlk çalıştırmada agent kendi Chromium'unu indirir; pencerede
"Ilk calistirma: kayit tarayicisi indiriliyor" yazar ve birkaç dakika sürer.
Sonraki açılışlarda anında bağlanır.

Pencerede şunu görmesi lazım:

```
TestKit Agent 0.1.0  -  AHMET-PC
Sunucu: http://192.168.1.40:3001
Bu pencereyi acik birakin. Kayit web sayfasindan baslatilir.
Baglandi: AHMET-PC (sunucu 0.1.0)
```

Sonra tarayıcıdan sunucu adresine girer. Sağ üstteki çizgi **yeşil** olur ve
makine adını gösterir.

---

## 4. İlk kaydı al (5 dakika)

1. **Kayıt** sekmesi
2. Makineyi seç, test edeceğin uygulamanın adresini yaz →
   **Kaydı başlat**
3. Analistin bilgisayarında Chromium açılır. Uygulamayı normalde nasıl
   kullanıyorsa öyle kullanır: tıklar, alan doldurur, dosya seçer, kaydeder.
   Adımlar web sayfasında canlı olarak görünür.
4. **Kaydı durdur**
5. Adımları gözden geçir, gereksizleri **Çıkar** ile at
6. Alt tabloda değişken önerileri çıkar (`musteriAdi`, `belgeFile`…). Koşular
   arasında değişmesini istediklerini işaretli bırak, sabit kalacakların işaretini
   kaldır
7. Senaryoya ad ver → **Senaryoyu kaydet**

## 5. Veri setlerini gir

Senaryo sayfasında **Veri setleri** panelinde:

1. Ad yaz (`Ahmet`) → **Veri seti ekle**
2. Metin alanlarını doldur → **Değerleri kaydet**
3. Dosya değişkeni için **Dosya seç** → `ahmet.xlsx`
4. Aynı şeyi `Mehmet` için tekrarla (ya da `Kopyala` ile başlayıp değiştir)

Sekmede `!` işareti varsa o sette eksik değer var; o set çalıştırılamaz.

## 6. Testi çalıştır

Senaryo sayfasındaki **Testi çalıştır** panelinde:

1. Hangi veri setleriyle koşacağını işaretle (birden fazla seçersen sırayla koşar)
2. **Çalıştır**
3. Koşu sayfası açılır; adımlar canlı olarak ✅ / ❌ / ⏭ ile dolar
4. Her adımın ekran görüntüsüne tıklayıp büyütebilirsin
5. Üstte büyük **GEÇTİ** / **BAŞARISIZ** sonucu görünür

Eksik bir değer varsa **Çalıştır** düğmesi pasif kalır ve neyin eksik olduğu
yazılır — tarayıcı hiç açılmaz.

**Koşular** sekmesinde tüm geçmiş durur. Bir koşuya girdiğinde o koşunun
kullandığı veriyi de görürsün; veri setini sonradan değiştirsen bile geçmiş koşu
değişmez.

---

## Node.js sürümü eski çıkarsa

`npm install` sırasında `EBADENGINE` uyarıları ve şu hata geliyorsa:

```
Prisma only supports Node.js >= 18.18.
```

makinede eski bir Node var. `node -v` ile bak; `v16` veya altı görüyorsan:

1. https://nodejs.org adresinden **LTS** sürümünü indir ve kur (Windows Installer,
   `.msi`). Eski sürümün üzerine yazar, ayrıca kaldırmak gerekmez.
2. **Bütün terminal ve komut istemi pencerelerini kapat**, yeniden aç. Açık
   pencereler eski sürümü hatırlar.
3. `node -v` → `v20.x` veya `v22.x` görmelisin.
4. Yarım kalan kurulumu temizle:

```
rmdir /s /q node_modules
del package-lock.json
```

5. `TestKit Server Baslat.cmd` dosyasına yeniden çift tıkla.

**Başka projeler Node 16 istiyorsa:** tek sürüme mahkûm değilsin,
[nvm-windows](https://github.com/coreybutler/nvm-windows) ile ikisini yan yana
tutabilirsin:

```
nvm install 22
nvm use 22
```

Bu proje Node 16'ya indirilemez: Prisma, Playwright ve Vite'ın hiçbir güncel
sürümü orada çalışmıyor ve Node 16 Eylül 2023'te destek dışı kaldı.

## Sık karşılaşılan durumlar

| Belirti | Sebep / çözüm |
| --- | --- |
| `EBADENGINE` + `Prisma only supports Node.js >= 18.18` | Node 16 veya altı kurulu → yukarıdaki bölüm |
| Sayfa hiç açılmıyor | Sunucu penceresi kapanmış ya da 3001 portu kapalı |
| Sunucu panelinde `veritabanı: unreachable` | `npx prisma migrate deploy` çalıştırılmamış |
| Çizgi kırmızı, "bağlı makine yok" | Analist bilgisayarında agent penceresi kapalı |
| Agent "Sunucu baglantiyi reddetti" diyor | Config dosyası yanlış yerde ya da token yenilenmiş → yeni **Config indir** |
| Agent "kayit tarayicisi indiriliyor"da takılıyor | O bilgisayarda internet yok; Chromium indirmesi gerekiyor |
| Kayıt başlıyor ama tarayıcı açılmıyor | Chromium indirmesi tamamlanmamış; agent penceresindeki mesajı oku |
| Kayıtta adım görünmüyor | Playwright'ın açtığı pencerede işlem yapıldığından emin ol (normal Chrome'da değil) |
| **Çalıştır** düğmesi pasif | Seçili veri setinde eksik değer var; panelde hangisi olduğu yazılı |
| Koşu hemen `HATA` veriyor | Sunucuda Chromium kurulu değil → `npx playwright install chromium` |
| Tüm adımlar zaman aşımına düşüyor | Sunucu, test edilecek uygulamaya erişemiyor (ağ/DNS) |
| İlk adım geçiyor, sonrası düşüyor | Uygulama giriş istiyor olabilir → oturum profili gerekiyor |

---

## Uygulama giriş istiyorsa

Test edilecek uygulama oturum açmayı gerektiriyorsa:

1. Kayıt sırasında analist tarayıcıda **bir kez elle giriş yapar** (SSO/MFA dahil)
2. Kayıt bittiğinde agent, oturum bilgisini `storageState` dosyası olarak üretir
3. O dosyayı **Makineler ve sunucu** bölümünden bir oturum profiline yüklersin
4. Koşular o profille başlar, yani zaten giriş yapmış olarak

Oturum süresi dolduğunda koşu net bir hatayla düşer; profili yenilemek için
kaydı tekrarlamak yeterli.

## Şu anda ne çalışıyor

Makine eşleştirme · kayıt alma · adım temizliği · değişken önerisi ·
senaryo/adım/değişken yönetimi · veri setleri · dosya yükleme · koşu öncesi
eksik kontrolü · oturum profilleri · **testi çalıştırma** · adım adım PASS/FAIL ·
her adımın ekran görüntüsü · canlı akış · toplu koşu · koşu geçmişi ve veri
anlık görüntüsü.

Henüz olmayan: sürükle-bırak adım sıralama, agent üzerinde gözle izlenen hata
ayıklama koşusu, tek dosya `.exe` paketlemesi, iframe desteği.

Güncelleme geldiğinde: `testkit` klasörünü değiştirip sunucuyu yeniden
başlatmak yeterli. `prisma/dev.db` ve `storage/` klasörü yerinde kalır, yani
senaryolar, veri setleri, dosyalar ve koşu geçmişi korunur.
