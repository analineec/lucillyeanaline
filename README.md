# Chá de Casa Nova Lucilly e Ana Aline 🏠🌈

Um site desenvolvido para organizar e gerenciar os presentes do meu chá de casa nova.

O projeto permite que convidados escolham presentes separados por ambientes da casa, realizem o pagamento dentro do site e tenham o presente marcado automaticamente como presenteado após a confirmação do pagamento.


---

##  Funcionalidades

- Lista de presentes organizada por ambientes
- Integração com Mercado Pago
- Confirmação automática via Webhook
- Atualização automática dos presentes pagos
- Exibição do nome de quem presenteou
- Layout responsivo

---


## Tecnologias

#### Frontend
- HTML
- CSS
- JavaScript
- Vercel

#### Backend
- Mercado Pago API
- PostgreSQL
- Node.js
- Express
- Render

---

##  Fluxo do Sistema

```txt
Convidado acessa o site
↓
Escolhe um presente
↓
Clica em "Presentear"
↓
Checkout transparente Mercado Pago é aberto
↓
Pagamento realizado
↓
Webhook recebe confirmação
↓
Presente é marcado como presenteado
