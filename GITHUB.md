# GitHub'a koyma

Depo bunun için hazırlandı: `.gitignore`, `.gitattributes`, CI ve güvenlik notları
yerinde. Bunu ben senin adına yapamam — hesabına erişimim yok ve bir erişim
token'ı paylaşmanı istemem doğru olmaz. Aşağıdaki adımlar birkaç dakika sürüyor.

## Önce: depoyu **private** aç

Bu bir şirket içi araç. İçinde parola yok, ama şunları taşıyor: iç ağdaki
uygulamanın adresleri, senaryo adları, alan isimleri ve Türkçe iş terimleri.
Ayrıca kimlik doğrulaması olmayan bir sunucunun tam kaynağı. Public bir depo
gerekmiyorsa **Private** seç.

## 1. Git kurulumu (bir kez)

Git zaten kurulu görünüyor (`C:\Program Files\Git`). Kimliğini bir kez ayarla:

```
git config --global user.name "Ahmet Monun"
git config --global user.email "sahmet.monun@sirket.com"
```

## 2. GitHub'da boş depo oluştur

github.com → **New repository**

- Ad: `testkit`
- **Private** işaretli
- "Add a README", "Add .gitignore", "Choose a license" → **hiçbirini işaretleme**
  (depoda zaten var, işaretlemek ilk push'ta çakışma yaratır)

## 3. Yerelde depoyu başlat ve gönder

`testkit` klasöründe (`C:\Users\sahmet.monun\Desktop\testkit`) komut istemi aç:

```
git init
git add .
git status
```

`git status` çıktısında **şunlar görünmemeli** — görünüyorsa dur ve bana yaz:

```
storage/            .env            prisma/dev.db
node_modules/       testkit-agent.config.json
```

Sonra:

```
git commit -m "TestKit: kayit, senaryo, veri seti ve kosu altyapisi"
git branch -M main
git remote add origin https://github.com/<kullanici-adin>/testkit.git
git push -u origin main
```

GitHub kullanıcı adı ve şifre sorarsa: şifre çalışmaz, **Personal Access Token**
gerekir. github.com → Settings → Developer settings → Personal access tokens →
Tokens (classic) → Generate new token → `repo` yetkisi. Token'ı şifre alanına
yapıştır. (Kolay yol: [GitHub CLI](https://cli.github.com) kurup `gh auth login`
demek; sonrasında `gh repo create testkit --private --source . --push` tek komutta
depoyu açar ve gönderir.)

## 4. CI'ı kontrol et

Push'tan sonra depodaki **Actions** sekmesinde bir çalışma başlar. Dört şeyi
denetler:

1. `npm ci` ile bağımlılıkları kurar
2. `prisma generate` — üretilen istemci tiplerini oluşturur
3. `npm run typecheck` — dört paketin tamamı
4. `npm run build` — arayüz derlenir
5. `prisma migrate deploy` — **şemanın boş bir SQLite dosyasına gerçekten
   uygulandığını doğrular**

Beşinci adım senin için ayrıca değerli: bu ortamda Prisma'nın motorunu
indiremediğim için migration'ı ben doğrulayamadım. İlk CI çalışması yeşil
yanarsa şema sağlam demektir; kırmızı yanarsa çıktısını bana at.

## 5. Bundan sonra güncelleme nasıl gider

Ben sana yeni bir sürüm verdiğimde:

```
git pull                    # veya yeni dosyaları klasöre kopyalayıp
git add . && git commit -m "..." && git push
```

Sunucu makinesinde:

```
git pull
npm install                 # bağımlılık değiştiyse
npx prisma migrate deploy   # şema değiştiyse
```

Sonra `TestKit Server Baslat.cmd`. **`prisma/dev.db` ve `storage/` klasörü
depoda olmadığı için `git pull` onlara dokunmaz** — senaryolar, veri setleri,
yüklenen dosyalar ve koşu geçmişi yerinde kalır.

Analist bilgisayarlarında da aynısı: `git pull`, sonra `TestKit Agent Baslat.cmd`.
`testkit-agent.config.json` depoda olmadığı için o da silinmez.

## Depoda ne var, ne yok

**Var:** kaynak kod (83 dosya), Prisma şeması, başlatıcı `.cmd` dosyaları,
`.env.example`, dokümantasyon, CI tanımı.

**Yok (bilinçli olarak):** `node_modules/`, `storage/` (dosyalar, ekran
görüntüleri, oturum bilgileri), `prisma/dev.db`, `.env`,
`testkit-agent.config.json`, paketlenmiş `.exe` çıktısı.

`.gitattributes` sayesinde `.cmd` dosyaları depoda LF olarak durur ama Windows'a
CRLF olarak iner. Bu önemsiz görünen ayrıntı önemli: LF satır sonlu bir batch
dosyası `cmd.exe` tarafından yanlış yorumlanır ve "command not found" verir.

## Lisans

Şirket içi ve private bir depoda lisans dosyası gerekmez. Public açmak ya da
başka ekiplerle paylaşmak istersen söyle, uygun bir LICENSE ekleyeyim.
