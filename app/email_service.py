import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

class EmailService:
    def __init__(self):
        self.smtp_host = os.getenv('SMTP_HOST', '')
        self.smtp_port = int(os.getenv('SMTP_PORT', 587))
        self.smtp_user = os.getenv('SMTP_USER', '')
        self.smtp_password = os.getenv('SMTP_PASSWORD', '')
        self.use_console = not (self.smtp_user and self.smtp_password)
    
    def send_verification_email(self, to_email: str, code: str, username: str):
        if self.use_console:
            print(f"\n📧 ===== ПИСЬМО ДЛЯ {username} ({to_email}) =====")
            print(f"Ваш код подтверждения: {code}")
            print(f"==========================================\n")
            return True
        
        try:
            subject = "Подтверждение регистрации в Domeshek Chat"
            body = f"""
            <html>
            <body style="font-family: Arial, sans-serif;">
                <h2>Добро пожаловать в Dark Chat, {username}!</h2>
                <p>Ваш код подтверждения:</p>
                <h1 style="color: #3a8c3a; font-size: 32px; letter-spacing: 5px;">{code}</h1>
                <p>Код действителен в течение 15 минут.</p>
                <hr>
                <small>Dark Chat — защищённый мессенджер</small>
            </body>
            </html>
            """
            
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.smtp_user
            msg['To'] = to_email
            msg.attach(MIMEText(body, 'html'))
            
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)
            
            print(f"✅ Email отправлен на {to_email}")
            return True
        except Exception as e:
            print(f"❌ Ошибка отправки email: {e}")
            return False

email_service = EmailService()