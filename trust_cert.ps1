$certPath = "C:\Cursor AI\localhost.pem"
if (Test-Path $certPath) {
    Try {
        Write-Host "Importing certificate to Trusted Root..."
        Import-Certificate -FilePath $certPath -CertStoreLocation Cert:\CurrentUser\Root
        Write-Host "Success! You might need to restart your browser."
    }
    Catch {
        Write-Host "Error importing certificate: $_"
    }
}
else {
    Write-Host "Certificate file not found at $certPath"
}
