import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from jinja2 import Template
import os

class EmailService:
    def __init__(self):
        self.smtp_host = os.getenv('SMTP_HOST')
        self.smtp_port = int(os.getenv('SMTP_PORT', 587))
        self.smtp_user = os.getenv('SMTP_USER')
        self.smtp_password = os.getenv('SMTP_PASSWORD')
        self.from_email = os.getenv('FROM_EMAIL', self.smtp_user)
    
    def send_verification_code(self, to_email: str, code: str, username: str):
        template = Template("""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                .container { max-width: 500px; margin: 0 auto; padding: 20px; }
                .code { font-size: 32px; font-weight: bold; color: #3a8c3a; 
                        text-align: center; padding: 20px; letter-spacing: 5px; }
                .footer { font-size: 12px; color: #888; text-align: center; margin-top: 30px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Добро пожаловать в Dark Chat, {{ username }}!</h2>
                <p>Ваш код подтверждения:</p>
                <div class="code">{{ code }}</div>
                <p>Код действителен в течение 15 минут.</p>
                <p>Если вы не регистрировались в Dark Chat, проигнорируйте это письмо.</p>
                <div class="footer">Dark Chat — защищённый мессенджер</div>
            </div>
        </body>
        </html>
        """)
        
        html = template.render(username=username, code=code)
        
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Подтверждение регистрации в Dark Chat'
        msg['From'] = self.from_email
        msg['To'] = to_email
        
        msg.attach(MIMEText(html, 'html'))
        
        with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
            server.starttls()
            server.login(self.smtp_user, self.smtp_password)
            server.send_message(msg)
    
    def send_password_reset(self, to_email: str, reset_token: str):
        # Аналогичная функция для сброса пароля
        pass