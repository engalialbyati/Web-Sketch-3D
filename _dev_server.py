'''Dev server with Cache-Control: no-store — the browser must always run
the files as they are on disk (stale ?v= caches cost hours of debugging).'''
import http.server, socketserver, os

PORT = 8642
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass


with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), NoCache) as httpd:
    httpd.allow_reuse_address = True
    print('serving on', PORT)
    httpd.serve_forever()
