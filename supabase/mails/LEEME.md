# Mails de TaListo! en español

Supabase deja editar los mails recién cuando hay un correo propio configurado
(Authentication → Emails → SMTP Settings). Cuando esté, en **Authentication → Emails → Templates**:

| Plantilla de Supabase | Asunto | Archivo |
| --- | --- | --- |
| Confirm sign up | Confirmá tu cuenta de TaListo! | confirmar_cuenta.html |
| Reset password | Cambiá tu contraseña de TaListo! | recuperar_clave.html |
| Change email address | Confirmá tu nuevo correo en TaListo! | cambiar_correo.html |
| Magic link or OTP | Tu enlace para entrar a TaListo! | link_de_acceso.html |

En cada una: pegar el asunto y el contenido del archivo en el cuerpo (Source) y guardar.
