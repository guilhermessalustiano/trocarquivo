# Trocarquivo

Upload e download de arquivos com API Node.js e armazenamento persistente em disco.

## Requisitos

- Node.js 22 ou superior e npm. A aplicação não possui dependências externas para instalar.
- Para instalação como serviço: Linux com systemd, Nginx, rsync e acesso administrativo (`sudo`).

Baixe ou clone o projeto e execute os comandos iniciais na pasta que contém `package.json`.

## Executar localmente

```sh
cp .env.example .env
npm start
```

Abra http://127.0.0.1:3000. Para reiniciar após alterações no servidor, use `npm run dev`.

## Configuração do .env

O servidor carrega o `.env` da pasta do projeto, mesmo quando iniciado de outro diretório. Variáveis já definidas no ambiente têm prioridade sobre esse arquivo.

| Variável | Função | Padrão sem configuração |
| --- | --- | --- |
| `UPLOADS_DIR` | Pasta dos arquivos enviados. Caminhos relativos são resolvidos a partir da pasta do projeto. | `./uploads` |
| `HOST` | Interface em que a API escuta. | `127.0.0.1` |
| `PORT` | Porta da API. | `3000` |

O `.env.example` é um modelo; o `.env` contém a configuração da instalação e fica fora do Git. Para manter os uploads fora do projeto, use um caminho absoluto em `UPLOADS_DIR`.

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

## Atualizar a instalação

Desenvolva em uma cópia separada e copie as mudanças para o servidor. A partir da pasta de desenvolvimento, repita o comando `rsync` da etapa 2: ele preserva o `.env` instalado e exclui `uploads/` da cópia. Não repita a criação do `.env`, pois ela sobrescreveria a configuração existente.

Depois de atualizar o código ou editar o `.env` instalado:

```sh
sudo systemctl restart trocarquivo.service
```

Se alterar o arquivo do serviço, instale-o novamente e execute `sudo systemctl daemon-reload` antes de reiniciar. Para alterações no Nginx, instale a configuração, execute `sudo nginx -t` e só então recarregue o serviço.

## Diagnóstico

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

Exemplo de envio (o endpoint recebe bytes diretamente, não multipart/form-data):

```sh
curl --data-binary @exemplo.txt \
  -H 'Content-Type: application/octet-stream' \
  'http://127.0.0.1:3000/api/files?name=exemplo.txt'

curl http://127.0.0.1:3000/api/files
```

O envio retorna HTTP 201 com `{ "file": { "id", "name", "size", "uploadedAt", "downloadUrl" } }`. A listagem retorna `{ "files": [...] }`, com tamanho em bytes e data ISO. Use o `downloadUrl` retornado para baixar. Erros retornam `{ "error": "mensagem" }`.

## Persistência

A pasta configurada em `UPLOADS_DIR` é criada automaticamente. Cada envio recebe um prefixo UUID para preservar arquivos com nomes repetidos. O nome original é exibido na interface e usado no download. A listagem também inclui arquivos comuns colocados diretamente nessa pasta; arquivos ocultos, diretórios e links simbólicos são ignorados.

O limite é de **50 MB por arquivo**. Nomes enviados devem ter até 180 bytes UTF-8, sem caminhos, caracteres de controle ou ponto inicial. Uploads são gravados temporariamente e só aparecem na lista após a conclusão. Arquivos permanecem disponíveis após recarregar a página ou reiniciar o processo. Preserve a pasta de uploads ao atualizar o projeto; em containers, monte um volume persistente nesse caminho. Arquivos enviados ficam fora do Git.

A API não possui autenticação: quem conseguir acessar o servidor pode enviar, listar e baixar arquivos. O uso padrão é local.

## Verificar

```sh
npm test
```

Os testes executam os handlers HTTP diretamente, sem abrir portas, usando diretórios temporários. Cobrem persistência entre instâncias, nomes repetidos, integridade binária, arquivos existentes, caminhos inválidos, links simbólicos, limites de tamanho e limpeza de uploads rejeitados.

## Referências

- [Guia oficial do Nginx](https://nginx.org/en/docs/beginners_guide.html)
- [Serviços systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
