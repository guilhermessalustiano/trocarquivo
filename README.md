# Trocarquivo

Envio, listagem, download, renomeação e exclusão de arquivos com API Node.js e armazenamento persistente em disco, no Linux e no Windows.

## Como funciona

O navegador acessa o Nginx pela porta 80. O Nginx entrega a interface da pasta `public/` e encaminha as requisições `/api/` para o Node.js na mesma máquina. A API executa as operações na pasta definida por `UPLOADS_DIR`.

Em produção, o WinSW inicia o Node.js como serviço no Windows e o systemd faz isso no Linux. O Nginx e a API precisam estar ativos para o fluxo completo funcionar. Os usuários acessam `http://IP_OU_NOME_DO_SERVIDOR`.

| Componente | Windows neste roteiro | Linux neste roteiro |
| --- | --- | --- |
| Código de produção | `C:\Program Files\Trocarquivo` | `/var/www/trocarquivo` |
| Uploads configuráveis no `.env` | `C:\ProgramData\Trocarquivo\uploads` | `/var/lib/trocarquivo/uploads` |
| API local | `127.0.0.1:3101` | `127.0.0.1:3000` |
| Serviço da API | WinSW, serviço `trocarquivo` | systemd, `trocarquivo.service` |

Mantenha a cópia de desenvolvimento na sua pasta pessoal e copie o código para produção ao publicar uma atualização. Os serviços executam `node server.js` diretamente. O npm é opcional em produção.

## Requisitos

- Node.js 22 ou superior. A aplicação não possui dependências externas para instalar. O npm é opcional para execução e testes.
- Para instalação em produção no Linux, use systemd, Nginx, rsync e acesso administrativo (`sudo`).
- Para instalação em produção no Windows, use Nginx para Windows, WinSW e acesso administrativo.

Baixe ou clone o projeto e execute os comandos iniciais na pasta que contém `package.json`.

## Executar em desenvolvimento

```sh
cp .env.example .env
npm start
```

No PowerShell, use `Copy-Item .env.example .env` para criar a configuração. Abra http://127.0.0.1:3000. Para reiniciar após alterações no servidor, use `npm run dev`. Também é possível executar diretamente com `node server.js` ou `node --watch server.js`.

## Configuração do .env

O servidor carrega o `.env` da pasta do projeto, mesmo quando iniciado de outro diretório. Variáveis já definidas no ambiente têm prioridade sobre esse arquivo.

| Variável | Função | Padrão sem configuração |
| --- | --- | --- |
| `UPLOADS_DIR` | Pasta dos arquivos enviados. Caminhos relativos são resolvidos a partir da pasta do projeto. | `./uploads` |
| `HOST` | Interface em que a API escuta. | `127.0.0.1` |
| `PORT` | Porta da API. | `3000` |

O `.env.example` é um modelo; o `.env` contém a configuração da instalação e fica fora do Git. Para manter os uploads fora do projeto, use um caminho absoluto em `UPLOADS_DIR`.

## Instalar em um servidor Windows

Mantenha a cópia de desenvolvimento na sua pasta pessoal. Neste exemplo, o código de produção fica em `C:\Program Files\Trocarquivo`, os dados e logs em `C:\ProgramData\Trocarquivo` e o Nginx em `C:\nginx`. Ajuste esses caminhos à sua instalação. O Nginx atende na porta 80, serve `public/` e encaminha `/api/` para o Node.js em `127.0.0.1:3101`. O WinSW executa `node.exe` como serviço com início automático.

### 1. Preparar a cópia de produção

Instale o Node.js 22 ou superior. Extraia a [distribuição oficial do Nginx para Windows](https://nginx.org/en/docs/windows.html) em `C:\nginx`, com `nginx.exe` diretamente nessa pasta. Baixe o executável [WinSW 2.12](https://github.com/winsw/winsw/releases/tag/v2.12.0) adequado à arquitetura da máquina.

Abra o PowerShell como administrador e entre na pasta do projeto baixado, que contém `server.js`, `public/` e `deploy/`. Execute as etapas na mesma sessão para manter as variáveis disponíveis. Os comandos a seguir criam as pastas de produção.

```powershell
$sourceDir = (Get-Location).Path
$appDir = Join-Path $env:ProgramFiles 'Trocarquivo'
$dataDir = Join-Path $env:ProgramData 'Trocarquivo'
$deployDir = Join-Path $appDir 'deploy'
$uploadsDir = Join-Path $dataDir 'uploads'
$logsDir = Join-Path $dataDir 'logs'
$nginxDir = 'C:\nginx'

New-Item -ItemType Directory -Force -Path $deployDir, $uploadsDir, $logsDir | Out-Null
Copy-Item -LiteralPath .\server.js, .\public -Destination $appDir -Recurse -Force
Copy-Item -LiteralPath .\deploy\trocarquivo.xml.example -Destination (Join-Path $deployDir 'trocarquivo.xml')
```

Salve o executável do WinSW como `trocarquivo.exe` ao lado de `trocarquivo.xml` em `$deployDir`. O XML fornecido usa a sintaxe do WinSW 2.12. Confira o caminho do Node.js com `(Get-Command node).Source`. Se for diferente de `C:\Program Files\nodejs\node.exe`, ajuste o elemento `executable` do XML.

Escolha a pasta de uploads ajustando `$uploadsDir` e gere o `.env` de produção em UTF-8. Execute esta criação na primeira instalação.

```powershell
$envText = @(
    ('UPLOADS_DIR="' + $uploadsDir.Replace('\', '/') + '"')
    'HOST=127.0.0.1'
    'PORT=3101'
) -join [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $appDir '.env'), $envText + [Environment]::NewLine)
```

Com a pasta padrão, o arquivo terá os valores a seguir.

```dotenv
UPLOADS_DIR="C:/ProgramData/Trocarquivo/uploads"
HOST=127.0.0.1
PORT=3101
```

Você pode escolher outro caminho, como `D:/Arquivos Compartilhados/Trocarquivo`. Use aspas em caminhos com espaços. O valor deve apontar para a pasta real. Caminhos relativos partem da pasta do projeto e variáveis como `%ProgramData%` não são expandidas no `.env`.

O serviço usa a conta interna `LocalService` (SID `S-1-5-19`). Dê a ela leitura no código e permissão de modificação em uploads e logs. Se escolheu outro caminho no `.env`, ajuste `$uploadsDir` antes de executar os comandos.

```powershell
New-Item -ItemType Directory -Force -Path $uploadsDir | Out-Null
icacls.exe $appDir /grant '*S-1-5-19:(OI)(CI)(RX)'
icacls.exe $dataDir /grant '*S-1-5-19:(RX)'
icacls.exe $uploadsDir /grant '*S-1-5-19:(OI)(CI)(M)'
icacls.exe $logsDir /grant '*S-1-5-19:(OI)(CI)(M)'
```

### 2. Iniciar a API como serviço

Instale o serviço uma única vez.

```powershell
$serviceWrapper = Join-Path $deployDir 'trocarquivo.exe'
& $serviceWrapper install
& $serviceWrapper start
Get-Service trocarquivo | ForEach-Object { $_.WaitForStatus('Running', [TimeSpan]::FromSeconds(30)) }
Get-Service trocarquivo
```

O processo Node.js pode levar alguns instantes para começar a atender. Depois que o serviço iniciar, verifique a API.

```powershell
Invoke-RestMethod http://127.0.0.1:3101/api/files
```

O serviço deve aparecer como `Running` e a API deve retornar `files`, que pode ser uma lista vazia. Se o primeiro teste falhar, repita-o após alguns segundos. Use `Start-Service trocarquivo` para iniciar um serviço parado e `Restart-Service trocarquivo` depois de editar o `.env`. O modelo configura início automático com o Windows e reinício após falhas.

### 3. Publicar pelo Nginx

O arquivo `deploy/nginx.conf.example` contém o bloco `server` do site. Copie o conteúdo ajustado para `conf\trocarquivo.conf` dentro da instalação do Nginx. Defina `$nginxDir` com a pasta que contém `nginx.exe` e a subpasta `conf`. Você pode usar uma instalação existente em outro caminho, como uma pasta extraída em Downloads. Algumas extrações criam dois níveis de pasta com o nome da versão.

```powershell
$publicRoot = (Join-Path $appDir 'public').Replace('\', '/')
$site = Get-Content -LiteralPath (Join-Path $sourceDir 'deploy\nginx.conf.example') -Raw -Encoding UTF8
$site = $site.Replace('/var/www/trocarquivo/public', ('"' + $publicRoot + '"'))
$site = $site.Replace('127.0.0.1:3000', '127.0.0.1:3101')
[IO.File]::WriteAllText((Join-Path $nginxDir 'conf\trocarquivo.conf'), $site)
```

Abra `conf\nginx.conf` da mesma instalação com `notepad (Join-Path $nginxDir 'conf\nginx.conf')`. Dentro do bloco `http { ... }`, mantenha a inclusão de `mime.types` e adicione a linha a seguir.

```nginx
include trocarquivo.conf;
```

Em uma instalação dedicada, remova o bloco `server` de exemplo que vem no `nginx.conf`. Em uma instalação compartilhada, ajuste `server_name` para o nome usado pelos clientes e remova `default_server` do modelo caso já exista um site padrão. A conta que executa o Nginx precisa ter leitura na pasta `public/`.

```powershell
Set-Location $nginxDir
.\nginx.exe -t
```

Depois que o teste passar, inicie com `Start-Process .\nginx.exe -WorkingDirectory $nginxDir -WindowStyle Hidden`. Se o Nginx já estiver em execução, recarregue com `.\nginx.exe -s reload`. Abra `http://127.0.0.1` e teste envio, listagem, download, renomeação e exclusão. Para acesso pela rede, libere TCP 80 para o perfil de rede aplicável no Firewall do Windows e use o IP ou nome do servidor.

O Nginx oficial é um processo de console. Se precisar iniciá-lo com o Windows e ainda não houver um mecanismo de inicialização, configure uma tarefa no Agendador de Tarefas com disparo **Ao inicializar**, programa `C:\nginx\nginx.exe`, diretório inicial `C:\nginx` e sem limite de duração. Use uma conta com leitura em `public/` e permissão para gravar os logs e arquivos temporários do Nginx. [Nginx para Windows](https://nginx.org/en/docs/windows.html)

Ajuste também os caminhos da tarefa se escolheu outro `$nginxDir`. Configure a tarefa para executar independentemente de o usuário estar conectado.

Confira o fluxo passando pelo Nginx com `Invoke-RestMethod http://127.0.0.1/api/files`. A porta do `proxy_pass` precisa coincidir com `PORT` no `.env` de produção. O modelo original e o `.env.example` usam `3000`, enquanto os comandos deste roteiro ajustam ambos para `3101`.

### Atualizar no Windows

No PowerShell como administrador, entre na pasta de desenvolvimento e execute os comandos a seguir. A atualização tem uma breve interrupção da API.

```powershell
$appDir = Join-Path $env:ProgramFiles 'Trocarquivo'
Stop-Service trocarquivo
Copy-Item -LiteralPath .\server.js -Destination $appDir -Force
Copy-Item -Path .\public\* -Destination (Join-Path $appDir 'public') -Recurse -Force
Start-Service trocarquivo
```

Preserve o `.env` de produção, o XML configurado e a pasta escolhida em `UPLOADS_DIR`. Se alterar a configuração do Nginx, execute `nginx.exe -t` na pasta dele antes de `nginx.exe -s reload`. Ao mudar `UPLOADS_DIR`, crie a pasta e conceda à conta do serviço permissão de modificação nesse caminho antes de reiniciar.

### Diagnóstico no Windows

```powershell
Get-Service trocarquivo
Get-Process nginx -ErrorAction SilentlyContinue
Get-Content (Join-Path $env:ProgramData 'Trocarquivo\logs\trocarquivo.out.log') -Tail 30
Get-Content (Join-Path $env:ProgramData 'Trocarquivo\logs\trocarquivo.err.log') -Tail 30
Get-Content (Join-Path $nginxDir 'logs\error.log') -Tail 30
```

| Sintoma | O que verificar |
| --- | --- |
| Serviço `Running` e conexão recusada | Veja no log `trocarquivo.out.log` em qual porta a API iniciou. Confira `PORT` no `.env` de produção e repita o teste após o início. |
| WinSW informa `already exists` | O serviço já foi instalado. Consulte `Get-Service trocarquivo` e use os comandos de início ou reinício. |
| Nginx mostra a página padrão | Confira a inclusão de `trocarquivo.conf`, o bloco `server` padrão e o caminho `root`. Valide e recarregue a configuração. |
| Nginx retorna `502` | Teste a API diretamente na porta definida no `.env` e confira o mesmo endereço em `proxy_pass`. |
| Acesso negado ao editar arquivos ou controlar o serviço | Execute o PowerShell como administrador. |
| Erro de permissão nos uploads | Confira a permissão de modificação da conta `LocalService` no caminho escolhido e o acesso aos diretórios que o contêm. |

## Instalar em um servidor Linux

O roteiro abaixo usa `/var/www/trocarquivo` para o código, `/var/lib/trocarquivo/uploads` para os arquivos e uma conta de serviço chamada `trocarquivo`. Esses são exemplos: adapte os caminhos e a conta à sua instalação. Execute os comandos de cópia a partir da pasta do projeto baixado.

### 1. Preparar a conta e as pastas

Instale Node.js 22 ou superior, Nginx e rsync pelo método adequado à distribuição. Confira:

```sh
node --version
command -v node
nginx -v
rsync --version
```

Crie uma conta de sistema exclusiva para a API, se ela ainda não existir:

```sh
sudo useradd --system --user-group --no-create-home trocarquivo
sudo install -d -m 755 /var/www/trocarquivo
sudo install -d -o trocarquivo -g trocarquivo -m 750 /var/lib/trocarquivo
sudo install -d -o trocarquivo -g trocarquivo -m 700 /var/lib/trocarquivo/uploads
```

A conta da API precisa ler o código e o `.env`, acessar os diretórios do caminho e escrever na pasta de uploads. O Nginx precisa ler `public/`. Evite conceder permissão de escrita a todos os usuários.

### 2. Copiar o projeto e configurar o ambiente

```sh
sudo rsync -rlt --chmod=D755,F644 \
  --exclude='.git/' --exclude='node_modules/' --exclude='uploads/' \
  --exclude='.env' --exclude='deploy/trocarquivo.service' --exclude='deploy/nginx.conf' \
  ./ /var/www/trocarquivo/
sudo install -o root -g trocarquivo -m 640 .env.example /var/www/trocarquivo/.env
sudo nano /var/www/trocarquivo/.env
```

Defina:

```dotenv
UPLOADS_DIR=/var/lib/trocarquivo/uploads
HOST=127.0.0.1
PORT=3000
```

O Nginx recebe as conexões da rede e encaminha a API para `127.0.0.1:3000`. Mantenha `HOST=127.0.0.1` quando ambos estiverem na mesma máquina.

### 3. Configurar o serviço systemd

Crie sua configuração a partir do modelo:

```sh
cp deploy/trocarquivo.service.example deploy/trocarquivo.service
nano deploy/trocarquivo.service
```

Substitua **todas as ocorrências** dos marcadores no arquivo:

| Marcador | Valor neste roteiro |
| --- | --- |
| `/CAMINHO/DO/PROJETO` | `/var/www/trocarquivo` |
| `/CAMINHO/DOS/UPLOADS` | `/var/lib/trocarquivo/uploads` |
| `/CAMINHO/DO/NODE` | Caminho absoluto retornado por `command -v node` |
| `USUARIO_DO_SERVICO` | `trocarquivo` |
| `GRUPO_DO_SERVICO` | `trocarquivo` |

O executável do Node precisa estar acessível à conta do serviço; instalações dentro da pasta pessoal de outro usuário podem impedir a execução. O serviço não depende de um terminal nem carrega configurações do shell.

Valide e instale:

```sh
systemd-analyze verify deploy/trocarquivo.service
sudo install -m 644 deploy/trocarquivo.service /etc/systemd/system/trocarquivo.service
sudo systemctl daemon-reload
```

Encerre qualquer instância iniciada manualmente que esteja usando a mesma porta. Depois:

```sh
sudo systemctl enable --now trocarquivo.service
systemctl status trocarquivo.service --no-pager
curl -i http://127.0.0.1:3000/api/files
```

O serviço deve aparecer como `active (running)` e a API deve responder HTTP 200. Ele inicia com o computador e reinicia após falhas com intervalo de 5 segundos. O `.env` é carregado pela própria API; não é necessário duplicar suas variáveis no serviço.

### 4. Configurar o Nginx

```sh
cp deploy/nginx.conf.example deploy/nginx.conf
nano deploy/nginx.conf
```

Ajuste `root` para a pasta `public/` da instalação. Confira se `proxy_pass` aponta para o mesmo endereço e porta definidos no `.env`. O modelo usa `http://127.0.0.1:3000`, preserva o caminho `/api/` e permite arquivos de até 50 MiB.

O exemplo assume que este será o site padrão da porta 80, com `default_server` e `server_name _`. Se já houver outro site padrão, ajuste os blocos existentes para manter somente um `default_server` por endereço e porta. Para hospedar vários sites, remova `default_server` deste modelo e configure `server_name` com o domínio escolhido, evitando nomes duplicados.

Instale o arquivo em um diretório incluído pelo bloco `http` do Nginx. Em instalações que incluem `/etc/nginx/conf.d/*.conf`:

```sh
sudo install -m 644 deploy/nginx.conf /etc/nginx/conf.d/trocarquivo.conf
sudo nginx -t
```

Somente depois de o teste passar:

```sh
sudo systemctl enable --now nginx.service
sudo systemctl reload nginx.service
curl -i http://127.0.0.1/api/files
```

Se sua distribuição usa `sites-available` e `sites-enabled`, instale e habilite o arquivo conforme esse padrão, sem carregá-lo também por `conf.d`.

### 5. Permitir acesso pela rede

Libere a porta TCP 80 no firewall da máquina. Use o procedimento correspondente ao firewall instalado.

Com **firewalld**, consulte `sudo firewall-cmd --get-active-zones` e substitua `ZONA_DA_REDE` pela zona da interface que receberá as conexões:

```sh
sudo firewall-cmd --zone=ZONA_DA_REDE --add-service=http
sudo firewall-cmd --permanent --zone=ZONA_DA_REDE --add-service=http
```

Com **UFW**, se estiver ativo:

```sh
sudo ufw allow 80/tcp
```

Em sistemas com SELinux, se os logs indicarem que o Nginx não pode se conectar à API, confira `getsebool httpd_can_network_connect`. Quando necessário, permita a conexão com `sudo setsebool -P httpd_can_network_connect on`. Para erros de acesso aos arquivos, confira permissões e contextos SELinux, mantendo o SELinux ativo.

Em outro dispositivo na mesma rede, abra `http://IP_DO_SERVIDOR`. `localhost` e `127.0.0.1` sempre apontam para o próprio dispositivo. Se o acesso local funcionar e o remoto não, confira firewall, endereço IP e isolamento de clientes no Wi-Fi.

## Atualizar a instalação no Linux

Desenvolva em uma cópia separada e copie as mudanças para o servidor. A partir da pasta de desenvolvimento, repita o comando `rsync` da etapa 2: ele preserva o `.env` instalado e exclui `uploads/` da cópia. Não repita a criação do `.env`, pois ela sobrescreveria a configuração existente.

Depois de atualizar o código ou editar o `.env` instalado:

```sh
sudo systemctl restart trocarquivo.service
```

Se alterar o arquivo do serviço, instale-o novamente e execute `sudo systemctl daemon-reload` antes de reiniciar. Para alterações no Nginx, instale a configuração, execute `sudo nginx -t` e só então recarregue o serviço.

## Diagnóstico no Linux

```sh
systemctl status trocarquivo.service nginx.service --no-pager
journalctl -u trocarquivo.service -n 50 --no-pager
sudo tail -n 50 /var/log/nginx/error.log
```

| Sintoma | O que verificar |
| --- | --- |
| `502 Bad Gateway` em `/api/files` | API ativa, porta correta no `proxy_pass` e permissão de conexão do Nginx. Teste primeiro `http://127.0.0.1:3000/api/files`. |
| `EACCES` na API | Permissões do usuário do serviço na pasta de uploads e nos diretórios do caminho. |
| `EADDRINUSE` | Outro processo já está usando a porta da API. |
| Serviço falha antes de iniciar | Marcadores não substituídos, Node inacessível ou `.env` ausente/ilegível. |
| Página funciona apenas no servidor | Firewall, IP usado no navegador e isolamento da rede Wi-Fi. |
| Aviso de site padrão/nome duplicado no Nginx | Outros blocos `server` usando o mesmo `default_server` ou `server_name`. |

## API

| Método | Endpoint | Função |
| --- | --- | --- |
| GET | `/api/files` | Lista os arquivos persistidos. |
| POST | `/api/files?name=nome.txt` | Salva o corpo binário da requisição como arquivo. |
| GET | `/api/files/:id` | Baixa o arquivo como anexo. |
| PATCH | `/api/files/:id?name=novo-nome.txt` | Renomeia o arquivo e retorna HTTP 200 com o objeto `file` atualizado. |
| DELETE | `/api/files/:id` | Exclui o arquivo da pasta de uploads e retorna HTTP 204. |

Exemplo de envio (o endpoint recebe bytes diretamente, não multipart/form-data):

```sh
curl --data-binary @exemplo.txt \
  -H 'Content-Type: application/octet-stream' \
  'http://127.0.0.1:3000/api/files?name=exemplo.txt'

curl http://127.0.0.1:3000/api/files
```

O envio retorna HTTP 201 com `{ "file": { "id", "name", "size", "uploadedAt", "downloadUrl" } }`. A listagem retorna `{ "files": [...] }`, com tamanho em bytes e data ISO. Use o `downloadUrl` retornado para baixar. Ao mudar o nome de um arquivo, passe a usar o novo `id` e o novo `downloadUrl` retornados. Erros retornam `{ "error": "mensagem" }`.

## Persistência

A pasta configurada em `UPLOADS_DIR` é criada automaticamente. Cada envio recebe um prefixo UUID para preservar arquivos com nomes repetidos. O nome original é exibido na interface e usado no download. A listagem também inclui arquivos comuns colocados diretamente nessa pasta; arquivos ocultos, diretórios e links simbólicos são ignorados.

O limite é de **50 MB por arquivo**. Nomes enviados devem ter até 180 bytes UTF-8, sem caminhos, caracteres de controle ou ponto inicial. Uploads são gravados temporariamente e só aparecem na lista após a conclusão. Arquivos permanecem disponíveis após recarregar a página ou reiniciar o processo. Preserve a pasta de uploads ao atualizar o projeto; em containers, monte um volume persistente nesse caminho. Arquivos enviados ficam fora do Git.

No Windows, o envio e a renomeação seguem as regras de nomes do sistema. Caracteres como `:` e `?`, nomes como `CON.txt` e ponto ou espaço ao final geram erro de validação. Revise esses nomes ao copiar arquivos de uma instalação Linux. [Regras de nomes de arquivo no Windows](https://learn.microsoft.com/pt-br/windows/win32/fileio/naming-a-file)

A API não possui autenticação: quem conseguir acessar o servidor pode enviar, listar, baixar, renomear e excluir arquivos. O uso padrão é local.

## Verificar

```sh
node --test
```

Os testes executam os handlers HTTP diretamente, sem abrir portas, usando diretórios temporários. Cobrem persistência entre instâncias, nomes repetidos, integridade binária, arquivos existentes, caminhos inválidos, links simbólicos, limites de tamanho e limpeza de uploads rejeitados.

No Windows, o teste de links simbólicos requer permissão para criá-los, disponível com o Modo de Desenvolvedor ou em um terminal com o privilégio correspondente. Os demais testes rodam sem essa permissão.

## Referências

- [Guia oficial do Nginx](https://nginx.org/en/docs/beginners_guide.html)
- [Serviços systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
