const nodeHtmlToImage = require('node-html-to-image');
const fs = require('fs');
const QRCode = require('qrcode');
const { options } = require('../routes/usuario');

const disfam = fs.readFileSync('./functions/logoRuidea.png');
const base64Disfam = new Buffer.from(disfam).toString('base64');
const URIDisfam = 'data:image/jpeg;base64,' + base64Disfam

const generateImage = async(url, nombre, pais, pasaporte) => {
    try{
        const qrLink = await QRCode.toDataURL(url);
        const img = await nodeHtmlToImage({
            html: "<html lang='en'> <head> <meta charset='UTF-8' /> <meta name='viewport' content='width=device-width, initial-scale=1.0' /> <title>Pasaporte RUIDEA</title> <link rel='stylesheet' href='https://use.typekit.net/nkh3uvc.css'> </head> <body style=' overflow-x: hidden; margin: 0; padding: 0; width: 480px; height: 900px; ' > <img src={{image}} height='180px' style='display: block; margin: auto; padding:20px 0 0 0;' /> <div class='container-datos' style=' display: flex; align-items: center; flex-direction: column; padding: 15px 0; box-sizing: border-box; ' > <div class='texto-main' style='text-align: center; padding: 10px 0 0 0;'> <h1 style=' font-family: muli; font-style: normal; font-weight: bold; font-size: 48px; color: #161616; margin: 0; ' > {{nombre}} </h1> <h3 style=' margin: 0; font-family: muli; font-style: normal; font-weight: 600; font-size: 36px; text-align: center; color: #648387; ' > {{pais}} </h3> </div> <h2 style=' font-family: muli; font-style: normal; font-weight: 600; font-size: 45px; line-height: 60px; margin: 10px 0 0 0; color: #151515; text-align: center; ' > Pasaporte N° <br /> {{pasaporte}} </h2> </div> <div class='container-qr' style='width: 180px; margin: auto;'> <img src={{qr}} alt='' width='100%' /> <p style=' font-family: muli; font-style: normal; font-weight: normal; font-size: 16px; text-align: center; margin: 0; ' > Escanear para ver validación </p> </div> <footer style=' background: #41a1ac; display: flex; align-items: center; justify-content: center; font-size: 20px; padding: 24px 0; font-family: muli; position: absolute; bottom: 0; margin: 0; width: 480px; color: #fff; ' > Sistema desarrollado por LectO </footer> </body></html>",
            content: { qr: qrLink,  image : URIDisfam, nombre, pais, pasaporte},
            encoding: 'base64'
        });

        return img;
    }
    catch(err){
        return err;
    }
}

module.exports = generateImage;
