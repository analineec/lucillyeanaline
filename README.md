<div align="center">

 <h1><b>Chá de Casa Nova</b><br><b>Lucilly e Ana Aline 🏠🌈</b></h1></b>

</div>

<br>

<p align="center">
  Um site desenvolvido para organizar e gerenciar os presentes do meu chá de casa nova.
</p>

<p align="center">
  O projeto permite que convidados escolham presentes separados por ambientes da casa, realizem o pagamento dentro do site e tenham o presente marcado automaticamente como presenteado após a confirmação do pagamento.
</p>

---

##  Funcionalidades

- Lista de presentes organizada por ambientes da casa
- Integração com o Mercado Pago para pagamentos online
- Confirmação automática de pagamentos via Webhook
- Atualização automática dos presentes após a confirmação do pagamento
- Presentes marcados automaticamente como “presenteados”, ficando indisponíveis para novos envios
- Layout responsivo, compatível com celulares, tablets e computadores
  
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
