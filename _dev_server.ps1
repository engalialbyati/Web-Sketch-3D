# Minimal no-cache static server (PowerShell), stand-in for _dev_server.py
$root = $PSScriptRoot
$mime = @{ '.html'='text/html'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json';
           '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.glb'='model/gltf-binary' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:8642/')
$listener.Start()
Write-Host 'serving on 8642'
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $p = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
  if ($p -eq '/') { $p = '/index.html' }
  $file = Join-Path $root ($p -replace '/', '\')
  try {
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) { throw 404 }
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $ctx.Response.Headers['Cache-Control'] = 'no-store, must-revalidate'
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    $ctx.Response.StatusCode = 404
  } finally {
    $ctx.Response.Close()
  }
}
